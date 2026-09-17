import { BindGroup, Geometry, Texture } from 'pixi.js';
import type { Buffer, Shader, State, TextureSource, Topology } from 'pixi.js';

import { Buffer3D } from '../buffers/Buffer3D';
import type { IndirectDrawData } from '../buffers/IndirectDrawData';
import type { CameraData } from '../CameraData';
import { MAX_BATCH_TEXTURES } from './batchConstants';

/**
 * Per-draw state that can't live in the numeric draw-calls buffer — applied before the draw
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
  /** Render state (blend / depth / cull) */
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
 * Resolves the draw-calls pixi `Buffer` to its backing `GPUBuffer` (pixi's `GpuBufferSystem`)
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
 * The lifecycle event every capturable resource emits (`Buffer` and `TextureSource` share it,
 * but their full event maps make the union's `on`/`off` uncallable in TypeScript)
 *
 * `change` fires exactly once for every way a resource's GPU identity can move: an explicit
 * `unload()` (which also emits `unload` right beside it), pixi's GC collecting it, a reallocation
 * growth, a resize, and destroy — so it is the one event a capture has to watch.
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
  public generation: number;
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
 * Each command carries pipeline state (geometry / shader / bind groups /
 * state / topology); the list tracks a `count`. The matching numeric args
 * (index counts, offsets, instance counts) live in a separate
 * `IndirectDrawData` the caller passes to `replay`: one command list can
 * drive several arg buffers (every frustum drawing the list replays the same
 * commands against its own `CullResult`'s counts), so the list owns no buffer of its own.
 *
 * ### Captures
 *
 * A build's recorded commands (and, on WebGPU, the bundles replaying them) bake references to GPU
 * resources that are never re-fetched: the resolved geometries' buffers and the batch texture
 * sources. The list tracks those captures for as long as a build bakes them, and two things keep a
 * capture honest:
 *
 * - A `change` listener marks the build stale when the resource's GPU copy dies — a user calling
 *   `texture.source.unload()`, in-place buffer growth, or pixi's GC collecting a resource nothing
 *   drew for a while. The listener drops the recorded GPU layout of the geometries that used a lost
 *   buffer (WebGL VAOs bake the dead handle) and reports through `onCaptureLost`, so the next frame
 *   rebuilds and re-records instead of replaying dead handles.
 * - `touch` stamps every capture as used on frames that replay a recorded bundle. Pixi stamps what
 *   it binds, and immediate-mode draws bind everything each frame, but a bundle replay binds
 *   nothing — without the stamp, pixi's GC would see a resource drawn every frame as idle.
 *
 * Captures carry a build generation: `clear` starts one and `endBuild` sweeps the captures the
 * build did not record again, so a pass that rebuilds every frame from the same resources adds no
 * listeners and allocates nothing. `releaseCaptures` drops them all for a build that is not coming
 * back (unload / destroy). Engine-owned `Buffer3D`s (stores, the atlas) are exempt from GC by
 * construction and are never captured.
 * @internal
 */
export class DrawCommandList {
  /** Pooled command instances; the first `count` entries are valid */
  public commands: DrawCommand[] = [];
  /** Number of valid entries in `commands` */
  public count = 0;

  /**
   * A rebuild id, bumped every time the list is cleared — i.e. at the start of every
   * batcher rebuild. Consumers that cache state derived from the draw program (a `CullResult`'s lane
   * copy and render bundle) snapshot it and re-sync when it moves, so they detect a rebuild without
   * the pass having to signal them — the same pattern as `Mesh3DBatch._visibilityDirtyId`. It tracks
   * rebuilds only: WebGL patches commands and draw args in place between rebuilds without moving it, so
   * only consumers of the rebuilt-list shape (WebGPU's cached bundles) may key on it.
   */
  public dirtyId = 0;

  /**
   * Invoked when a captured resource's GPU copy is lost while this build is live. Set by the owning
   * `DrawList` to bump its dirty counters so the next frame rebuilds.
   */
  public onCaptureLost?: () => void;

  /** The captured resources, each with the generation that last recorded it */
  private readonly _captures = new Map<CapturedResource, Capture>();

  /** The current build generation; `clear` advances it */
  private _generation = 0;

  /** Texture bind groups owned by this list, pooled by flush order and reused across builds */
  private readonly _bindGroups: BindGroup[] = [];
  private _bindGroupCount = 0;

  private readonly _onCaptureResourceLost = (resource: CapturedResource): void => {
    const geometries = this._captures.get(resource)?.geometries;
    if (geometries) {
      // Only the recorded GPU layout goes (the base `Geometry.unload`); a `Geometry3D`'s own
      // unload would also vacate its atlas range and unload every buffer it owns.
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
   * Records that the current build resolved a command to `geometry`, capturing each of its buffers
   * for the build. Deduplicated — the batcher calls this per emitted command.
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
   * Stamp every captured resource as used at `now` (pixi's `gc.now`)
   *
   * Call it on every frame that replays a recorded bundle; immediate-mode draws are stamped by
   * pixi's own bind paths.
   * @param now - The frame's GC clock.
   */
  public touch(now: number): void {
    for (const resource of this._captures.keys()) resource._gcLastUsed = now;
  }

  /**
   * Drop the recorded commands and every capture, and empty every pooled bind group — for a build
   * that is not coming back (unload / destroy). `clear` alone keeps the captures for the rebuild
   * that follows it.
   */
  public releaseCaptures(): void {
    this.clear();
    this._dropCaptures();
    this._emptyBindGroups(0);
  }

  /**
   * WebGPU replay: one `drawIndirect` per command, counts sourced from `data`'s buffer
   *
   * The per-command geometry / shader / state come from this list; `data`
   * supplies only the numeric args, so each cull result replays the shared
   * commands against its own survivor counts.
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
   * Drop the recorded commands, release every capture, and destroy the owned texture bind groups
   *
   * The numeric args are owned + freed by the pass's `IndirectDrawData`.
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
