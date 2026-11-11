import { Geometry } from 'pixi.js';
import type { Buffer, Shader, State, TextureSource, Topology } from 'pixi.js';

import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import { Buffer3D } from '../buffers/Buffer3D';
import type { IndirectDrawData } from '../buffers/IndirectDrawData';
import type { CameraData } from '../CameraData';
import { SHARED_DEFAULT_TEXTURES } from '../textures/DefaultTextures';
import { DrawCommand } from './DrawCommand';
import { DrawCommandCapture } from './DrawCommandCapture';
import type { CapturedResource } from './DrawCommandCapture';

interface CaptureTicked {
  _captureTick?: number;
}

interface CaptureStamped {
  _capturedResourceId?: number;
  _capturedStyleId?: number;
}

/**
 * Bumped when a captured texture source or its style changes; material bind groups don't watch their
 * sources, so they refresh when it moves (`refreshMaterialBindings`)
 */
let textureDirtyId = 0;

/** Stamps a texture source with its own and its style's `_resourceId`; true when an earlier stamp differs */
function recordTextureIds(source: TextureSource & CaptureStamped): boolean {
  const id = source._resourceId;
  const styleId = source.style ? source.style._resourceId : -1;
  const moved =
    source._capturedResourceId !== undefined &&
    (source._capturedResourceId !== id || source._capturedStyleId !== styleId);
  source._capturedResourceId = id;
  source._capturedStyleId = styleId;
  return moved;
}

interface DrawOptions {
  geometry: Geometry;
  shader: Shader;
  state: State;
  topology: Topology;
  size: number;
  instanceCount: number;
  start: number;
  baseVertex: number;
  firstInstance: number;
}

interface DrawEncoder {
  draw(options: DrawOptions): void;
}

/** Refilled per draw so a replay allocates nothing, and emptied after so it pins no resource */
const _drawOptions: DrawOptions = {
  geometry: null!,
  shader: null!,
  state: null!,
  topology: 'triangle-list',
  size: 0,
  instanceCount: 0,
  start: 0,
  baseVertex: 0,
  firstInstance: 0,
};

interface DrawIndirectEncoder {
  drawIndirect(options: {
    geometry: Geometry;
    shader: Shader;
    state: State;
    topology: Topology;
    indirectBuffer: GPUBuffer;
    indirectOffset: number;
  }): void;
}

interface DrawCallsResolver {
  getGPUBuffer(buffer: Buffer): GPUBuffer;
}

interface CaptureLifecycleEvents {
  on(event: 'change' | 'styleChange', fn: (resource: CapturedResource) => void): unknown;
  off(event: 'change' | 'styleChange', fn: (resource: CapturedResource) => void): unknown;
}

let lastCaptureTick = 0;

/**
 * An ordered list of draw commands that every frustum drawing it replays against its own numeric args
 *
 * It listens to every buffer and texture source its build or a tail command bakes, and reports one
 * whose GPU copy goes, or whose style changes, through `onCaptureLost`.
 * @internal
 */
export class DrawCommandList {
  /** Pooled commands; the first `count` are in use */
  public commands: DrawCommand[] = [];
  public count = 0;

  /** Commands the last build recorded; those from here to `count` are tail commands, which no bundle holds */
  public bodyCount = 0;

  /** Bumped once per rebuild, by `clear`; a draw list's edits leave it alone (`DrawList.rangesDirtyId`) */
  public dirtyId = 0;

  public onCaptureLost?: () => void;

  private readonly _captures = new Map<CapturedResource, DrawCommandCapture>();

  private _destroyed = false;

  /** This build's tick, unique across lists, since geometries and materials keep the last tick that captured them */
  public captureTick: number = ++lastCaptureTick;

  /**
   * Drops the GPU layouts that bake a lost buffer through the base `Geometry.unload`, since
   * `Geometry3D.unload` would also vacate the atlas range; for a texture source it bumps `textureDirtyId`
   */
  private readonly _onCaptureResourceLost = (resource: CapturedResource): void => {
    const geometries = this._captures.get(resource)?.geometries;
    if (geometries) {
      for (const geometry of geometries) Geometry.prototype.unload.call(geometry);
    } else {
      recordTextureIds(resource as TextureSource);
      textureDirtyId++;
    }
    this.onCaptureLost?.();
  };

  /**
   * Hands out the pooled command at `count`, so a builder may lower `count` to drop the commands after it
   * @returns The command to fill in
   */
  public next(): DrawCommand {
    const i = this.count;
    const cmd = (this.commands[i] ??= new DrawCommand());
    cmd.dead = false;
    cmd.leftOut = false;
    this.count = i + 1;
    return cmd;
  }

  /** Captures each of `geometry`'s buffers for the current build */
  public captureGeometry(geometry: Geometry): void {
    const ticked = geometry as Geometry & CaptureTicked;
    if (ticked._captureTick === this.captureTick) return;
    ticked._captureTick = this.captureTick;

    const buffers = geometry.buffers;
    for (let i = 0; i < buffers.length; i++) {
      this._capture(buffers[i], geometry);
    }
  }

  /**
   * Captures a material's texture sources for the current build and refreshes its bind groups; skips the
   * shared default textures, which are never destroyed or collected
   */
  public captureMaterialTextures(material: BaseMaterial3D): void {
    if (material._captureTick === this.captureTick) return;
    material._captureTick = this.captureTick;

    const textures = material._textures;
    for (let t = 0; t < textures.length; t++) {
      if (!SHARED_DEFAULT_TEXTURES.has(textures[t])) this._capture(textures[t].source, null);
    }

    this.refreshMaterialBindings(material);
  }

  /**
   * Captures a tail command's buffers and textures while it has members, counting the command as an
   * owner even of resources the build or another tail command holds
   */
  public captureTail(command: DrawCommand, geometry: Geometry, material: BaseMaterial3D | null): void {
    const held = command.captures;

    const buffers = geometry.buffers;
    for (let i = 0; i < buffers.length; i++) {
      const capture = this._capture(buffers[i], geometry, true);
      if (capture) held.push(capture);
    }
    if (!material) return;

    const textures = material._textures;
    for (let t = 0; t < textures.length; t++) {
      if (SHARED_DEFAULT_TEXTURES.has(textures[t])) continue;
      const capture = this._capture(textures[t].source, null, true);
      if (capture) held.push(capture);
    }

    this.refreshMaterialBindings(material);
  }

  /**
   * Gives back a tail command's captures once its last member leaves; a buffer capture that stays
   * forgets the command's geometry unless something else still draws it
   */
  public releaseTail(command: DrawCommand): void {
    const held = command.captures;
    const geometry = command.geometry;
    let tailDraws = false;
    for (let i = this.bodyCount; i < this.count && !tailDraws; i++) {
      const other = this.commands[i];
      tailDraws = other !== command && other.geometry === geometry && other.captures.length > 0;
    }
    const drawn = tailDraws || (geometry as Geometry & CaptureTicked)._captureTick === this.captureTick;

    for (let i = 0; i < held.length; i++) {
      const capture = held[i];
      if (--capture.tailOwners > 0 || capture.generation === this.captureTick) {
        if (!drawn && capture.geometries) {
          const at = capture.geometries.indexOf(geometry);
          if (at >= 0) capture.geometries.splice(at, 1);
        }
        continue;
      }
      this._unwatch(capture);
      this._captures.delete(capture.resource);
    }
    held.length = 0;
  }

  /** Refreshes a material's bind groups if a texture changed since their last refresh */
  public refreshMaterialBindings(material: BaseMaterial3D): void {
    if (material._lastTextureDirtyId === textureDirtyId) return;
    material._lastTextureDirtyId = textureDirtyId;
    material._refreshTextureBindings();
  }

  /**
   * Captures a resource for the current build, or for a tail command, watching it if nothing did
   * @returns The capture, or `undefined` for an engine-owned `Buffer3D`, which pixi's GC never frees
   */
  private _capture(
    resource: CapturedResource,
    geometry: Geometry | null,
    tail = false,
  ): DrawCommandCapture | undefined {
    if (resource instanceof Buffer3D) return undefined;

    const generation = tail ? -1 : this.captureTick;
    let capture = this._captures.get(resource);
    if (capture === undefined) {
      capture = new DrawCommandCapture(resource, generation, geometry);
      this._captures.set(resource, capture);
      (resource as unknown as CaptureLifecycleEvents).on('change', this._onCaptureResourceLost);
      if (geometry === null) this._watchTexture(resource as TextureSource);
    } else {
      if (!tail && capture.generation !== generation) {
        capture.generation = generation;
        if (capture.geometries) capture.geometries.length = 0;
      }
      if (geometry && capture.geometries && !capture.geometries.includes(geometry)) capture.geometries.push(geometry);
    }
    if (tail) capture.tailOwners++;

    return capture;
  }

  /**
   * Watches `styleChange` as well as `change`, since a WebGPU bundle replays the sampler it recorded, and
   * bumps `textureDirtyId` if the source changed while no list watched it
   */
  private _watchTexture(source: TextureSource): void {
    (source as unknown as CaptureLifecycleEvents).on('styleChange', this._onCaptureResourceLost);
    if (recordTextureIds(source)) textureDirtyId++;
  }

  private _unwatch(capture: DrawCommandCapture): void {
    const events = capture.resource as unknown as CaptureLifecycleEvents;
    events.off('change', this._onCaptureResourceLost);
    if (capture.geometries === null) events.off('styleChange', this._onCaptureResourceLost);
  }

  private _dropCaptures(): void {
    for (const capture of this._captures.values()) this._unwatch(capture);
    this._captures.clear();
  }

  /** Resets the list for a rebuild; the old captures stay until `endBuild` sweeps those not recorded again */
  public clear(): void {
    for (let i = this.bodyCount; i < this.count; i++) {
      const held = this.commands[i].captures;
      for (let c = 0; c < held.length; c++) held[c].tailOwners = 0;
      held.length = 0;
    }
    this.captureTick = ++lastCaptureTick;
    this.count = 0;
    this.bodyCount = 0;
    this.dirtyId++;
  }

  /** Finishes a rebuild: sweeps the captures it didn't record again, and makes every command the body's */
  public endBuild(): void {
    this.bodyCount = this.count;
    const generation = this.captureTick;
    for (const capture of this._captures.values()) {
      if (capture.generation === generation) continue;
      this._unwatch(capture);
      this._captures.delete(capture.resource);
    }
  }

  /**
   * Stamps every captured resource as used; call it on frames that replay a bundle, since a replay binds
   * nothing for pixi's GC to see
   */
  public touch(now: number): void {
    for (const resource of this._captures.keys()) resource._gcLastUsed = now;
  }

  /** Drops the commands and every capture, for a build that isn't coming back; `clear` keeps the captures */
  public releaseCaptures(): void {
    this.clear();
    this._dropCaptures();
  }

  /**
   * Draws each command from the CPU-side counts in `data`, skipping a size of 0, which pixi takes as the whole buffer
   *
   * A bundle that records these draws bakes the counts, so it re-records on `CullResult.countsDirtyId`.
   */
  public replayDirect(encoder: DrawEncoder, data: IndirectDrawData, camera: CameraData): void {
    const args = data.drawCalls;
    const { bindGroup } = camera;
    const options = _drawOptions;
    for (let i = 0; i < this.count; i++) {
      const o = i * 5;
      const instanceCount = args[o + 1];
      if (instanceCount === 0 || args[o] === 0) continue;
      const cmd = this.commands[i];
      cmd.shader.groups[0] = cmd.globalBindGroup;
      cmd.shader.groups[1] = bindGroup;
      if (cmd.batchBindGroup) cmd.shader.groups[2] = cmd.batchBindGroup;
      options.geometry = cmd.geometry;
      options.shader = cmd.shader;
      options.state = cmd.state;
      options.topology = cmd.topology;
      options.size = args[o];
      options.instanceCount = instanceCount;
      options.start = args[o + 2];
      options.baseVertex = args[o + 3];
      options.firstInstance = args[o + 4];
      encoder.draw(options);
    }
    options.geometry = null!;
    options.shader = null!;
    options.state = null!;
  }

  /** Records one `drawIndirect` per live command (WebGPU), reading command `i`'s five `u32` args at byte `i * 20` */
  public replay(
    encoder: DrawIndirectEncoder,
    resolver: DrawCallsResolver,
    data: IndirectDrawData,
    camera: CameraData,
    from = 0,
    to = this.count,
  ): void {
    const indirectBuffer = resolver.getGPUBuffer(data.drawCallsBuffer);
    const { bindGroup } = camera;
    for (let i = from; i < to; i++) {
      const cmd = this.commands[i];
      if (cmd.dead) {
        cmd.leftOut = true;
        continue;
      }
      cmd.shader.groups[0] = cmd.globalBindGroup;
      cmd.shader.groups[1] = bindGroup;
      if (cmd.batchBindGroup) cmd.shader.groups[2] = cmd.batchBindGroup;
      encoder.drawIndirect({
        geometry: cmd.geometry,
        shader: cmd.shader,
        state: cmd.state,
        topology: cmd.topology,
        indirectBuffer,
        indirectOffset: i * 20,
      });
    }
  }

  /** Drops the recorded commands and releases every capture; the numeric args aren't this list's to free */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._dropCaptures();
    this.onCaptureLost = undefined;
    this.count = 0;
    (this.commands as DrawCommand[] | null) = null;
  }
}
