import { DrawCommandList } from '../batcher/DrawCommandList';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { DrawArgs } from '../buffers/DrawArgs';
import { RenderInstanceBuffer } from '../buffers/RenderInstanceBuffer';
import type { RenderInstanceTexture } from '../buffers/RenderInstanceTexture';

/**
 * Options for constructing a {@link DrawList}
 * @internal
 */
interface DrawListOptions {
  /** The renderables backing the sorted view */
  items: Mesh3DData[];
  /** Debug label applied to the GPU instance buffer */
  label: string;
  /** Initial capacity of the sorted view */
  initialCapacity?: number;
}

/**
 * WebGL-specific state of a {@link DrawList}
 *
 * WebGL has nothing baked: the compaction runs on the CPU inside each draw and its output is
 * consumed by the GL calls that follow, so every pass drawing the list rewrites one shared index
 * texture in place. There is no per-pass record on this backend.
 */
interface GlData {
  /** The number of instance slots currently in use */
  usedSlots: number;
  /**
   * The compaction output — one texel per *drawn* instance naming a mesh store row
   *
   * Survivors only, written contiguously from each command's stable base, rewritten before
   * every draw that reads it. `null` until this list first builds for its batch.
   */
  indexTexture: RenderInstanceTexture | null;
  /**
   * The build's output — one texel per instance in sorted order, before culling
   *
   * Kept separate from `indexTexture` so the build's output survives a frame's culling and every
   * draw can compact from it afresh.
   */
  indexStaging: Uint32Array | null;
  /**
   * Last `Mesh3DBatch._visibilityDirtyId` the in-place compaction consumed
   *
   * `-1` forces the walk on first use; a mismatch means visibility changed since the last walk,
   * so a visibility-only draw re-runs it (frustum producers run every draw regardless).
   */
  lastVisibilityDirtyId: number;
}

/**
 * WebGPU-specific state of a {@link DrawList}
 *
 * The build output every pass's cull reads from, and the counter that tells every pass's
 * bundle to re-record. What a pass bakes — its survivors, its counts, its bundle — lives on
 * that pass's `CullResult`.
 */
interface GpuData {
  /**
   * Interleaved per-draw-order instance records `[storeIndex, packedTextureSlots]`
   *
   * The id half indirects into the store buffer; the texture-slot half feeds the
   * batch-texture unpack. Written by `populateIds` (ids) + the batcher (slots). The
   * compactions read it and write their survivors elsewhere, so it survives a frame's culling.
   */
  instanceBuffer: RenderInstanceBuffer;
  /**
   * Bumped when something a bundle baked at record time changes while the draw commands stay valid
   *
   * The render graph bumps it when a texture a pass samples swaps source, as a pooled texture does
   * when the viewport crosses into another size bucket, or dies and gives way to a placeholder.
   * `View3D._invalidateBundleCaches` bumps it
   * when a global binding changes identity, such as the shadow map, and {@link DrawList.unload}
   * bumps it too. A rebuild needs no bump: it moves the command list's dirty id, and every result
   * re-syncs and drops its bundle on that (`CullResult.sync`). A camera swap is caught per result
   * by the bind group {@link CullResult.isBundleStale} is handed, and a target changing attachment
   * state or winding by the encoder's bundle stamp at replay. Every pass drawing this list keeps
   * its own watermark of this one counter. WebGL never reads it, since it rebinds everything live.
   */
  bundleDirtyId: number;
}

/**
 * The draw list of one pass bit on one batch: the renderables in draw order, the draw commands
 * built from them, and the build output the compactions read
 *
 * Camera-independent, and built once per shape change. Every pass that draws this list
 * reads the same list; what a camera decides — which instances survive, how many each
 * command draws, and the bundle recorded for them — lives per pass, in a `CullResult` on
 * WebGPU, and is rewritten in place per draw on WebGL (see {@link GlData}).
 *
 * Rebuilds are gated by counter/watermark pairs. Anything that invalidates cached work
 * bumps a counter ({@link DrawList.drawDirtyId}, `GpuData.bundleDirtyId`); whoever owns that
 * work stores the value it last built from ({@link DrawList.lastDrawDirtyId},
 * `CullResult.lastBundleDirtyId`) and redoes it only when the two differ. The counters live on
 * the batch/pass slot rather than the View, so dirtying one mesh costs just the batch and pass
 * it belongs to — every other batch replays its cache untouched. That scoping is the whole
 * point; a View-wide flag would make one moving mesh rebuild the scene.
 *
 * Naming: a counter is `<thing>DirtyId` when it tracks content or shape changing
 * (draw work, visibility, a material's shader descriptor), and `<thing>Version` when
 * it tracks a resource's identity changing (a buffer reallocating under cached bind
 * state). A watermark is `last` + the counter's name — named for what it watches,
 * not the host it sits on — with the underscore applied to both halves or neither.
 *
 * Write a watermark only where the work it guards actually ran. Claiming one on a path
 * that skipped the build leaves the batch replaying a stale cache until some unrelated
 * change happens to bump the counter again. The stale check ({@link isDrawStale}) is pure
 * and safe to ask from any phase; the claims ({@link claimDrawBuilt}, {@link claimDrawEmpty})
 * write a pair atomically and are the only places the draw watermarks should move.
 * @internal
 */
export class DrawList {
  /**
   * Renderable count the current {@link commandList} was built from
   *
   * A second gate beside {@link drawDirtyId}, since adds and removes bump that too.
   * Passes that deliberately build nothing park it at `0` so the next frame rebuilds;
   * `-1` can never match a real count, so the first frame always builds. Written only
   * by {@link claimDrawBuilt} / {@link claimDrawEmpty}.
   */
  public lastCount = -1;

  /** The meshes this batch contributes to this pass, held in draw order */
  public view: SortedMesh3DView<Mesh3DData>;

  /**
   * Bumped when the *shape* of this batch's draw work for this pass changes: a renderable
   * added or removed, a mesh rekeyed by `RenderPass.onRenderableDirty` (its shader,
   * material or geometry changed), a shared store the recorded commands bind into
   * growing and reallocating underneath them, or a resource the commands captured losing its
   * GPU copy (`DrawCommandList.onCaptureLost`).
   */
  public drawDirtyId = 0;

  /**
   * The {@link drawDirtyId} the current {@link commandList} was built from
   *
   * `-1` forces the first build. Written only by {@link claimDrawBuilt} /
   * {@link claimDrawEmpty}.
   */
  public lastDrawDirtyId = -1;

  /**
   * How this list is culled, chosen from its batch's `cull` mode and the instance count
   *
   * The forward draws (`prepareForwardBatchesGpu`, `renderForwardBatchesGl`) and the shadow passes
   * set it. On WebGPU it picks what fills a pass's survivors: `'off'` the visibility-only walk,
   * `'cpu'` and `'gpu'` the frustum compactions; bundles always bind the survivors. On WebGL it
   * routes the batcher's in-place cull.
   */
  public _cullProducer: 'off' | 'cpu' | 'gpu' = 'off';

  /** Shared draw-command cache both backends replay */
  public commandList = new DrawCommandList();

  /**
   * The draw args as the batcher built them: the static lanes (index counts, offsets,
   * `firstInstance`) and each command's full instance count, CPU-side only
   *
   * WebGL draws straight from it, rewriting the `instanceCount` lanes in place per draw. On
   * WebGPU it is the template every pass's `CullResult` copies its own GPU-backed args from on
   * sync; the culls then rewrite the copies, never this.
   */
  public drawData = new DrawArgs();

  /** WebGPU state (the pre-cull instance buffer and the bundle invalidation counter) */
  public gpuData: GpuData;

  /** WebGL state (index staging + the in-place compaction texture) */
  public glData: GlData;

  private _destroyed = false;

  constructor(options: DrawListOptions) {
    this.view = new SortedMesh3DView<Mesh3DData>(options.items, options.initialCapacity);

    this.glData = {
      indexTexture: null,
      indexStaging: null,
      usedSlots: 0,
      lastVisibilityDirtyId: -1,
    };

    this.gpuData = {
      instanceBuffer: new RenderInstanceBuffer(options.label),
      bundleDirtyId: 0,
    };

    this.commandList.onCaptureLost = () => {
      this.drawDirtyId++;
    };
  }

  /**
   * Whether the cached draw work (command list / instance data) is stale for `count` renderables
   *
   * Pure — prepare, compute, and render may all ask in the same frame; claiming is
   * separate ({@link claimDrawBuilt}). Callers OR in their own extra conditions (e.g.
   * `alwaysRebuild`). Per batch-pass, not per item — don't call from instance walks.
   * @param count - The renderable count the caller is about to draw
   * @returns Whether the cached draw work must be rebuilt
   */
  public isDrawStale(count: number): boolean {
    return this.drawDirtyId !== this.lastDrawDirtyId || count !== this.lastCount;
  }

  /**
   * Claims the draw watermarks after (re)building draw work for `count` renderables
   *
   * Call only where the build actually ran — claiming on a skipped path leaves a
   * stale cache replaying (see the class doc).
   * @param count - The renderable count the draw work was built for
   */
  public claimDrawBuilt(count: number): void {
    this.lastDrawDirtyId = this.drawDirtyId;
    this.lastCount = count;
  }

  /**
   * Claims for a pass that deliberately built nothing (zero renderables): the id is
   * consumed and the count parked at `0`, so the next non-empty frame rebuilds
   */
  public claimDrawEmpty(): void {
    this.lastDrawDirtyId = this.drawDirtyId;
    this.lastCount = 0;
  }

  /**
   * Gives back everything this list holds on the GPU, keeping the CPU state that rebuilds it:
   * the recorded draw program (and with it every capture its build took on textures and
   * geometry buffers), the GPU copy of the instance buffer, and the WebGL instance-index
   * texture
   *
   * The draw watermark is invalidated because the cleared command list must not be replayed
   * as-is — the renderable count alone is unchanged, so nothing else would notice it went
   * empty — and the bundle counter moves so every pass's `CullResult` re-records against the
   * rebuild. Idempotent, and recoverable by construction: the next frame rebuilds.
   */
  public unload(): void {
    if (this._destroyed) return;

    this.commandList.releaseCaptures();
    this.drawDirtyId++;

    this.gpuData.bundleDirtyId++;
    this.gpuData.instanceBuffer.unload();
    this.glData.indexTexture?.unload();
  }

  /**
   * Releases the GPU resources this list exclusively owns: the instance buffer, the draw
   * args and the WebGL index texture
   *
   * The cached shaders/geometry/bind groups referenced by recorded draw commands are
   * shared and not destroyed here. Passes' `CullResult`s are theirs to release.
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this.gpuData.instanceBuffer.destroy();

    this.glData.indexTexture?.destroy();
    this.glData.indexTexture = null;
    this.glData.indexStaging = null;

    this.view.clear();
    this.commandList.destroy();
    this.drawData.destroy();
  }
}
