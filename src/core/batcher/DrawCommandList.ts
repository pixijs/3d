import { BindGroup, Geometry, Texture } from 'pixi.js';
import type { Buffer, Shader, State, TextureSource, Topology } from 'pixi.js';

import { Buffer3D } from '../buffers/Buffer3D';
import type { IndirectDrawData } from '../buffers/IndirectDrawData';
import type { CameraData } from '../CameraData';
import { MAX_BATCH_TEXTURES } from './batchConstants';

/**
 * The state one draw binds before it runs, everything except the numeric args
 * @internal
 */
export class DrawCommand {
  /** Geometry bound for the draw */
  public geometry: Geometry = null!;
  /** Compiled shader program for the draw */
  public shader: Shader = null!;
  /** Global bind group, assigned to `shader.groups[0]` at replay */
  public globalBindGroup: BindGroup = null!;
  /** Optional batch-texture bind group, assigned to `shader.groups[2]` at replay (group 1 is the camera's) */
  public batchBindGroup: BindGroup | undefined = undefined;
  /** Render state: blending, depth and culling */
  public state: State = null!;
  /** Primitive topology */
  public topology: Topology = null!;
}

/**
 * WebGPU encoder subset: an indirect draw sourcing its counts from a `GPUBuffer`
 * @internal
 */
interface DrawIndirectEncoder {
  /** Record one indirect draw reading its numeric args from `indirectBuffer` at `indirectOffset` */
  drawIndirect(options: {
    geometry: Geometry;
    shader: Shader;
    state: State;
    topology: Topology;
    indirectBuffer: GPUBuffer;
    indirectOffset: number;
  }): void;
}

/**
 * Resolves a pixi `Buffer` to its `GPUBuffer`, as pixi's `GpuBufferSystem` does
 * @internal
 */
interface DrawCallsResolver {
  /**
   * Resolve a pixi `Buffer` to its backing `GPUBuffer`
   * @param {Buffer} buffer - The pixi buffer to resolve.
   * @returns The backing GPU buffer.
   */
  getGPUBuffer(buffer: Buffer): GPUBuffer;
}

/**
 * A resource a build bakes without ever re-fetching: a geometry buffer or a batch texture source
 * @internal
 */
type CapturedResource = Buffer | TextureSource;

/**
 * The lifecycle event every capturable resource emits
 *
 * `Buffer` and `TextureSource` both emit it, but their full event maps make `on` and `off`
 * uncallable on the union in TypeScript. `change` fires once for every way a resource's GPU copy can
 * be replaced: `unload()`, which also emits `unload`, pixi's GC collecting it, a buffer growing, a
 * texture resizing, and `destroy()`. It is the one event a capture has to watch.
 */
interface CaptureLifecycleEvents {
  on(event: 'change', fn: (resource: CapturedResource) => void): unknown;
  off(event: 'change', fn: (resource: CapturedResource) => void): unknown;
}

/**
 * One captured resource's bookkeeping, kept for as long as a build bakes the resource
 * @internal
 */
class Capture {
  /** The build generation that last recorded the resource; `endBuild` sweeps older stamps */
  public generation = 0;
  /**
   * Geometries whose recorded commands bake the resource (their GPU layouts must drop when it
   * dies), or `null` for a texture source (bind groups re-key themselves; only the rebuild matters)
   */
  public readonly geometries: Geometry[] | null;

  constructor(
    public readonly resource: CapturedResource,
    generation: number,
    geometry: Geometry | null,
  ) {
    this.generation = generation;
    this.geometries = geometry ? [geometry] : null;
  }
}

/**
 * An ordered list of draw commands
 *
 * Each command carries the geometry, shader, bind groups, state and topology of one draw. The
 * numeric args (index counts, offsets, instance counts) come separately, from the `DrawArgs`
 * or `IndirectDrawData` the caller hands to the draw. One list can drive several sets of args: every
 * frustum that draws it replays the same commands against its own `CullResult`'s counts. So the list
 * owns no args buffer.
 *
 * ### Captures
 *
 * A build's commands, and on WebGPU the bundles that replay them, hold GPU resources they never
 * fetch again: the geometries' buffers and the batch texture sources. The list tracks those
 * captures for as long as a build holds them, and keeps each one honest two ways:
 *
 * - A `change` listener marks the build stale when the resource's GPU copy goes, whether a user
 *   called `texture.source.unload()`, a buffer grew in place, or pixi's GC collected a resource
 *   nothing drew for a while. It drops the recorded GPU layout of the geometries that used a lost
 *   buffer, since a WebGL VAO holds the dead handle, and reports through `onCaptureLost`, so the
 *   next frame rebuilds instead of replaying dead handles.
 * - `touch` stamps every capture as used on frames that replay a recorded bundle. Pixi stamps what
 *   it binds, and an immediate-mode draw binds everything every frame, but a bundle replay binds
 *   nothing. Without the stamp, pixi's GC would see a resource drawn every frame as idle.
 *
 * Captures carry a build generation. `clear` starts a new one and `endBuild` sweeps the captures
 * the build didn't record again, so a pass that rebuilds every frame from the same resources adds
 * no listeners and allocates nothing. `releaseCaptures` drops them all for a build that isn't
 * coming back. Engine-owned {@link Buffer3D}s, such as the stores and the geometry atlas, are
 * exempt from the GC and never captured.
 * @internal
 */
export class DrawCommandList {
  /** Pooled command instances; the first `count` entries are valid */
  public commands: DrawCommand[] = [];
  /** Number of valid entries in `commands` */
  public count = 0;

  /**
   * Bumped by `clear`, so once at the start of every rebuild
   *
   * A `CullResult` caches its copy of the draw args and its render bundle against it, and re-syncs
   * when it moves, with no signal from the pass. It counts rebuilds only: WebGL rewrites the draw
   * args' instance counts in place between rebuilds without moving it.
   */
  public dirtyId = 0;

  /**
   * Called when a captured resource's GPU copy is lost while this build holds it
   *
   * The owning `DrawList` sets it to bump its dirty counters, so the next frame rebuilds.
   */
  public onCaptureLost?: () => void;

  /** The captured resources, each with the generation that last recorded it */
  private readonly _captures = new Map<CapturedResource, Capture>();

  /** The current build generation; `clear` advances it */
  private _generation = 0;

  /** Texture bind groups owned by this list, pooled by flush order and reused across builds */
  private readonly _bindGroups: BindGroup[] = [];
  private _bindGroupCount = 0;

  /**
   * Drops the recorded GPU layout of the geometries that used a lost buffer, then reports the loss
   *
   * It calls the base `Geometry.unload`, which drops only the layout. A `Geometry3D`'s own `unload`
   * would also vacate its atlas range and unload every buffer it owns.
   * @param resource - The captured resource whose GPU copy went
   */
  private readonly _onCaptureResourceLost = (resource: CapturedResource): void => {
    const geometries = this._captures.get(resource)?.geometries;
    if (geometries) {
      for (const geometry of geometries) Geometry.prototype.unload.call(geometry);
    }
    this.onCaptureLost?.();
  };

  /**
   * Append and return the next command slot, reusing a pooled instance when one exists
   * @returns The command to fill in.
   */
  public next(): DrawCommand {
    const i = this.count;
    const cmd = (this.commands[i] ??= new DrawCommand());
    this.count = i + 1;
    return cmd;
  }

  /**
   * Captures each of `geometry`'s buffers for the current build
   *
   * The batcher calls it for every command it emits. A geometry already captured this build isn't
   * recorded twice.
   * @param geometry - The geometry the emitted command draws
   */
  public captureGeometry(geometry: Geometry): void {
    const buffers = geometry.buffers;
    for (let i = 0; i < buffers.length; i++) {
      this._capture(buffers[i], geometry);
    }
  }

  /**
   * Hands out the next pooled texture bind group with `sources[0..slotCount)` in the batch slots
   * and the remaining slots padded empty, capturing each source for the build
   *
   * Groups are pooled by flush order. Pixi's `BindGroupSystem` already shares one native bind group
   * between groups that resolve to the same resource key, so identical sets cost nothing extra.
   * @param sources - Texture sources for the batch, in slot order
   * @param slotCount - How many leading entries of `sources` fill batch slots
   */
  public nextBatchBindGroup(sources: TextureSource[], slotCount: number): BindGroup {
    const bg = (this._bindGroups[this._bindGroupCount++] ??= new BindGroup());
    for (let s = 0; s < slotCount; s++) {
      bg.setResource(sources[s], s);
      this._capture(sources[s], null);
    }
    const empty = Texture.EMPTY.source;
    for (let s = slotCount; s < MAX_BATCH_TEXTURES; s++) bg.setResource(empty, s);
    return bg;
  }

  private _capture(resource: CapturedResource, geometry: Geometry | null): void {
    if (resource instanceof Buffer3D) return;

    const generation = this._generation;
    let capture = this._captures.get(resource);
    if (capture === undefined) {
      capture = new Capture(resource, generation, geometry);
      this._captures.set(resource, capture);
      (resource as unknown as CaptureLifecycleEvents).on('change', this._onCaptureResourceLost);
      return;
    }

    if (capture.generation !== generation) {
      capture.generation = generation;
      if (capture.geometries) capture.geometries.length = 0;
    }
    if (geometry && capture.geometries && !capture.geometries.includes(geometry)) capture.geometries.push(geometry);
  }

  /** Stops listening to every captured resource and forgets them */
  private _dropCaptures(): void {
    for (const resource of this._captures.keys()) {
      (resource as unknown as CaptureLifecycleEvents).off('change', this._onCaptureResourceLost);
    }
    this._captures.clear();
  }

  /**
   * Points every slot of the pooled groups from `from` onwards at the empty texture, so a group the
   * current build left unused retains none of the previous build's sources
   * @param from - Index of the first pooled group to clear
   */
  private _emptyBindGroups(from: number): void {
    const empty = Texture.EMPTY.source;
    for (let i = from; i < this._bindGroups.length; i++) {
      const bg = this._bindGroups[i];
      for (let s = 0; s < MAX_BATCH_TEXTURES; s++) bg.setResource(empty, s);
    }
  }

  /**
   * Reset the list for a rebuild, bumping `dirtyId`
   *
   * The previous build's captures stay until `endBuild` decides which of them the rebuild recorded
   * again.
   */
  public clear(): void {
    this._generation++;
    this._bindGroupCount = 0;
    this.count = 0;
    this.dirtyId++;
  }

  /**
   * Finish a rebuild: sweep the captures this build did not record again and empty the pooled bind
   * groups it left unused
   */
  public endBuild(): void {
    const generation = this._generation;
    for (const capture of this._captures.values()) {
      if (capture.generation === generation) continue;
      (capture.resource as unknown as CaptureLifecycleEvents).off('change', this._onCaptureResourceLost);
      this._captures.delete(capture.resource);
    }
    this._emptyBindGroups(this._bindGroupCount);
  }

  /**
   * Stamps every captured resource as used at `now`, pixi's `gc.now`
   *
   * Call it on every frame that replays a recorded bundle. Pixi's own bind calls stamp an
   * immediate-mode draw's resources.
   * @param now - The frame's GC clock.
   */
  public touch(now: number): void {
    for (const resource of this._captures.keys()) resource._gcLastUsed = now;
  }

  /**
   * Drops the recorded commands and every capture, and empties every pooled bind group
   *
   * For a build that isn't coming back: an unload, or the last renderable leaving the pass. `clear`
   * alone keeps the captures for the rebuild that follows it.
   */
  public releaseCaptures(): void {
    this.clear();
    this._dropCaptures();
    this._emptyBindGroups(0);
  }

  /**
   * Records one `drawIndirect` per command, reading its args from `data`'s GPU buffer (WebGPU)
   *
   * Each command's geometry, shader and state come from this list, and only the numeric args from
   * `data`, so every cull result replays the same commands against its own counts. Command `i`'s
   * args start at byte `i * 20`, five `u32`s.
   * @param encoder - Encoder the indirect draws are recorded into.
   * @param resolver - Resolves the draw-calls buffer to its `GPUBuffer`.
   * @param data - Numeric draw args for this replay.
   * @param camera - The camera these commands draw from; its group is bound at 1.
   */
  public replay(
    encoder: DrawIndirectEncoder,
    resolver: DrawCallsResolver,
    data: IndirectDrawData,
    camera: CameraData,
  ): void {
    const indirectBuffer = resolver.getGPUBuffer(data.drawCallsBuffer);
    const { bindGroup } = camera;
    for (let i = 0; i < this.count; i++) {
      const cmd = this.commands[i];
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

  /**
   * Drops the recorded commands, releases every capture, and destroys the pooled texture bind groups
   *
   * The numeric args aren't this list's to free.
   */
  public destroy(): void {
    this._dropCaptures();
    for (let i = 0; i < this._bindGroups.length; i++) this._bindGroups[i].destroy();
    this._bindGroups.length = 0;
    this._bindGroupCount = 0;
    this.onCaptureLost = undefined;
    this.count = 0;
    this.commands.length = 0;
  }
}
