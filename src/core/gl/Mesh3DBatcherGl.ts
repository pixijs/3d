import type { BindGroup, Geometry, Shader, TextureSource, Topology, WebGLRenderer } from 'pixi.js';
import { GlobalResourceRegistry, Texture } from 'pixi.js';

import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import type { Frustum } from '../../math/misc/Frustum';
import { MAX_BATCH_TEXTURES } from '../batcher/batchConstants';
import type { DrawCommandList } from '../batcher/DrawCommandList';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import type { DrawArgs } from '../buffers/DrawArgs';
import { RenderInstanceTexture } from '../buffers/RenderInstanceTexture';
import type { CameraData } from '../CameraData';
import { transformFrustumToBatch } from '../cull';
import type { DrawList } from '../render-passes/DrawList';
import { NORMAL_MAP } from '../textures/DefaultTextures';

/**
 * Options for `Mesh3DBatcherGl.build`
 * @internal
 */
interface GlBatcherBuildOptions {
  /** The sorted view of meshes to batch */
  renderables: SortedMesh3DView<Mesh3DData>;
  /** The pass's draw list for the batch (command list, index staging + texture) */
  list: DrawList;
  /** Bind group set as group 0 on every recorded draw command */
  globalBindGroup: BindGroup;
  /** Which pass to read shader/state from: `_passCache[passBit]` */
  passBit: number;
  /**
   * When true, skip texture slot packing and the batch texture bind group (batchBindGroup)
   *
   * Use for passes whose shader declares no batch group (e.g. shadow), so that draw does
   * not try to set `shader.groups[2]` on a shader that has no `_uniformBindMap` entry for group 2.
   */
  skipTextureBatching?: boolean;
}

// Null-object for meshes with no atlas allocation — avoids ternaries in the hot loop
const noAlloc: {
  atlas: null;
  indexCount: undefined;
  firstIndex: undefined;
} = {
  atlas: null,
  indexCount: undefined,
  firstIndex: undefined,
};

// Extend TextureSource with batch tracking fields
interface BatchedTextureSource extends TextureSource {
  _batchTick: number;
  _batchSlot: number;
}

// Sanity checks for reserved texture UIDs
if (Texture.EMPTY.source.uid !== 0) {
  throw new Error('Texture.EMPTY.source.uid is not 0');
}
if (Texture.WHITE.source.uid !== 1) {
  throw new Error('Texture.WHITE.source.uid is not 1');
}
if (NORMAL_MAP.source.uid !== 2) {
  throw new Error('NORMAL_MAP.source.uid is not 2');
}

/**
 * Monotonically increasing tick used to track which texture sources have already been assigned a
 * slot in the current batch
 *
 * Incremented by 2 for each new batch so that the speculative probe (`tick + 1`) stays an
 * integer, keeping all `_batchTick` values as V8 Smis.
 */
let batchTick = 0;

// Stand-in for the plane array on visibility-only compactions; never actually tested against.
const _noPlanes = new Float32Array(24);

/**
 * Batches 3D meshes for WebGL instanced rendering, with a cached DrawCommandList and a
 * per-pass {@link RenderInstanceTexture}
 *
 * Per-instance data is fetched, not attributed: everything about a mesh already lives in its
 * batch's mesh store, so a pass only records *which* store row each drawn instance reads.
 * `instanceFetchBitGl` does the two hops in the vertex shader.
 *
 * ## Build phase (only when dirty)
 * Sorts renderables, walks sorted order assigning each mesh a stable slot `i`, writes its
 * store row (plus this pass's packed texture slots) into the index staging array at `i`, and
 * records a DrawCommandList with firstInstance/instanceCount per batch.
 *
 * ## Draw phase (every frame)
 * Compacts the staging array into the index texture, dropping hidden and frustum-culled
 * instances and rebuilding each command's instance count, uploads it, then issues the draws.
 * `firstInstance` rides as one `uniform1i` — no per-command vertex state at all.
 *
 * Index texel: `[storeIndex, slotsLo, slotsHi, spare]`, 16 bytes per instance.
 * @see `Mesh3DBatcher` — the WebGPU equivalent
 * @see `MaterialSystemGl` — owns the single GL batcher instance
 * @internal
 */
export class Mesh3DBatcherGl {
  /** Per-slot texture sources for the current batch — written into the BindGroup */
  private readonly _sources = Array.from<BatchedTextureSource>({ length: MAX_BATCH_TEXTURES });

  /** Scratch field — avoids returning a tuple from `_packTextures` / `_commitTextures` */
  private _lastSlotCount = 0;

  /**
   * Build phase: sorts renderables, walks sorted order, writes each mesh's index texel, and
   * records draw commands
   *
   * After build, the mesh at sorted position `i` has its index texel at `i * 4` in the
   * pass's staging array. The draw compacts that into the texture.
   * @param options - What to batch and the draw list it lands in
   * @returns The total number of instances written (== renderables.count)
   */
  public build(options: GlBatcherBuildOptions): number {
    const { renderables, list, globalBindGroup, passBit, skipTextureBatching } = options;
    const len = renderables.count;
    if (len === 0) return 0;

    const commandList = list.commandList;
    commandList.clear();
    this._ensureCapacity(list, len);

    const indices = renderables.indices;
    const items = renderables.items;
    const glData = list.glData;
    const index = glData.indexStaging!;

    const sources = this._sources;

    let batchStart = 0;
    let texBatchStart = 0;
    let r = items[indices[0]];
    let cache = r._passCache[passBit];
    let currentShader = cache.shader;
    let currentBatchKey = cache.batchKey;
    let currentGeometry = r.geometry;
    let currentState = cache.state;
    let currentTopology = cache.topology;

    let currentAlloc = currentGeometry._geometryAtlasAllocation || noAlloc;
    let geometry: Geometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : currentGeometry;
    let drawStart = currentAlloc.firstIndex;
    let drawSize = currentAlloc.indexCount;

    let tick = (batchTick += 2);
    let slotCount = 0;
    let prevMaterial: BaseMaterial3D | null = null;
    let prevPackedSlots = 0;

    // --- Process first mesh ---
    {
      const packedSlots = this._packTextures(r.material, sources, tick);
      slotCount = this._lastSlotCount;

      this._writeIndex(index, 0, r, packedSlots);
      prevMaterial = r.material;
      prevPackedSlots = packedSlots;
    }

    // --- Main build loop ---
    for (let i = 1; i < len; i++) {
      r = items[indices[i]];
      cache = r._passCache[passBit];

      // One compare covers shader, state, topology and geometry: `batchKey` carries all of
      // them exactly. There is no instance cap: the index texture grows to fit, so a run of
      // like-keyed meshes is one draw however long it gets.
      const needsFlush = cache.batchKey !== currentBatchKey;

      if (!needsFlush) {
        const m = r.material;

        if (m === prevMaterial) {
          this._writeIndex(index, i, r, prevPackedSlots);
          continue;
        }

        // Speculative check: can we fit this item's textures?
        const textures = m._textures;
        const probeTick = tick + 1;
        let needed = 0;

        for (let t = 0; t < textures.length; t++) {
          const src = textures[t].source as BatchedTextureSource;
          if (src.uid > 2 && src._batchTick < tick) {
            src._batchTick = probeTick;
            needed++;
          }
        }

        if (slotCount + needed <= MAX_BATCH_TEXTURES) {
          const packedSlots = this._commitTextures(textures, sources, tick);
          slotCount = this._lastSlotCount;
          prevMaterial = m;
          prevPackedSlots = packedSlots;

          this._writeIndex(index, i, r, packedSlots);
          continue;
        }
      }

      // --- FLUSH: record draw command ---
      this._recordCommand(
        commandList,
        list.drawData,
        globalBindGroup,
        currentShader!,
        currentState,
        geometry,
        drawStart,
        drawSize,
        batchStart,
        i - batchStart,
        currentTopology,
      );

      // --- Reset for new batch ---
      batchStart = i;
      currentShader = cache.shader;
      currentBatchKey = cache.batchKey;
      currentGeometry = r.geometry;
      currentState = cache.state;
      currentTopology = cache.topology;

      currentAlloc = currentGeometry._geometryAtlasAllocation || noAlloc;
      geometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : currentGeometry;
      drawStart = currentAlloc.firstIndex;
      drawSize = currentAlloc.indexCount;

      // When the batch key changed, try to keep the current texture bind
      // group alive so multiple draw commands share it.
      if (needsFlush) {
        const m = r.material;

        if (m === prevMaterial) {
          this._writeIndex(index, i, r, prevPackedSlots);
          continue;
        }

        const textures = m._textures;
        const probeTick = tick + 1;
        let needed = 0;

        for (let t = 0; t < textures.length; t++) {
          const src = textures[t].source as BatchedTextureSource;
          if (src.uid > 2 && src._batchTick < tick) {
            src._batchTick = probeTick;
            needed++;
          }
        }

        if (slotCount + needed <= MAX_BATCH_TEXTURES) {
          const packedSlots = this._commitTextures(textures, sources, tick);
          slotCount = this._lastSlotCount;
          prevMaterial = m;
          prevPackedSlots = packedSlots;

          this._writeIndex(index, i, r, packedSlots);
          continue;
        }
      }

      // --- TEXTURE FLUSH ---
      // Slots are full. Finalise the bind group and back-assign it to every
      // draw command emitted since the last texture flush. Skipped in texture-skipping passes
      // (depth / shadow / solid-colour) — those shaders sample no material textures, so building and
      // binding a group would be wasted work / a stray binding. Mirrors the WebGPU twin and the end-of-batch
      // flush below.
      if (!skipTextureBatching) {
        const bg = commandList.nextBatchBindGroup(sources, slotCount);
        const cmds = commandList.commands;
        for (let c = texBatchStart; c < commandList.count; c++) {
          cmds[c].batchBindGroup = bg;
        }
        texBatchStart = commandList.count;
      }

      tick = batchTick += 2;
      slotCount = 0;
      prevMaterial = null;

      const packedSlots = this._packTextures(r.material, sources, tick);
      slotCount = this._lastSlotCount;

      this._writeIndex(index, i, r, packedSlots);
      prevMaterial = r.material;
      prevPackedSlots = packedSlots;
    }

    // --- Final flush ---
    this._recordCommand(
      commandList,
      list.drawData,
      globalBindGroup,
      currentShader!,
      currentState,
      geometry,
      drawStart,
      drawSize,
      batchStart,
      len - batchStart,
      currentTopology,
    );

    if (!skipTextureBatching) {
      const bg = commandList.nextBatchBindGroup(sources, slotCount);
      const cmds = commandList.commands;
      for (let c = texBatchStart; c < commandList.count; c++) {
        cmds[c].batchBindGroup = bg;
      }
    }

    commandList.endBuild();

    glData.usedSlots = len;
    // The index the compaction reads from just changed, so last frame's survivor set is
    // meaningless. `-1` can never match a real dirty id, which forces the walk below.
    list.glData.lastVisibilityDirtyId = -1;

    return len;
  }

  /**
   * Refreshes this pass's instance index if it can have changed, then issues its draws
   *
   * The compaction (`_compact`) drops hidden and out-of-frustum instances and rebuilds each
   * command's `instanceCount`; commands culled to nothing are skipped here.
   * @param renderer - The WebGL renderer issuing the draws
   * @param list - This pass's persistent per-batch state
   * @param batch - The batch whose commands are drawn
   * @param cullFrustum - Frustum to compact against, or `null` to skip frustum culling
   * @param camera - The camera these commands draw from; its group is bound at 1
   */
  public draw(
    renderer: WebGLRenderer,
    list: DrawList,
    batch: Mesh3DBatch,
    cullFrustum: Frustum | null,
    camera: CameraData,
  ): void {
    const indexTexture = list.glData.indexTexture;
    // No index texture means this pass never built for this batch — nothing to draw.
    if (!indexTexture) return;

    const frustumCull = cullFrustum !== null && list._cullProducer === 'cpu';

    // The visibility-only compaction is pure CPU work whose answer can only change when
    // something was hidden or shown, and that bumps the batch's dirty id — so on a frame
    // where it didn't move, last frame's texture and instance counts still stand and the
    // walk plus its upload are skipped outright. `build` parks the id at -1, so a rebuild
    // always walks. A frustum producer can never skip: the camera is one of its inputs and
    // it has no change signal. This is also what stops the shadow pass repeating an
    // identical walk once per cascade per light.
    if (frustumCull || list.glData.lastVisibilityDirtyId !== batch._visibilityDirtyId) {
      this._compact(list, batch, frustumCull ? cullFrustum : null, indexTexture);
    }

    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const gl = (renderer as any).gl as WebGL2RenderingContext;
    const shaderSys = renderer.shader;
    const geoSys = renderer.geometry;
    const stateSys = renderer.state;

    const commandList = list.commandList;
    const commandCount = commandList.count;
    const drawCalls = list.drawData.drawCalls;

    for (let i = 0; i < commandCount; i++) {
      const b = i * 5;
      if (drawCalls[b + 1] === 0) continue; // command culled to nothing — skip bind + draw
      const cmd = commandList.commands[i];

      cmd.shader.groups[0] = cmd.globalBindGroup;
      cmd.shader.groups[1] = camera.bindGroup;
      if (cmd.batchBindGroup) cmd.shader.groups[2] = cmd.batchBindGroup;

      shaderSys.bind(cmd.shader);
      geoSys.bind(cmd.geometry, shaderSys._activeProgram);
      if (cmd.state) stateSys.set(cmd.state);

      // Location 0 is valid, so this checks for undefined rather than truthiness.
      const location = shaderSys._getProgramData(shaderSys._activeProgram).uniformData.uInstanceBase?.location;
      if (location !== undefined) gl.uniform1i(location, drawCalls[b + 4]);

      geoSys.draw(cmd.topology, drawCalls[b], drawCalls[b + 2], drawCalls[b + 1]);
    }
  }

  /**
   * Walks the build's staging index, drops hidden and out-of-frustum instances, and writes the
   * survivors into the index texture
   *
   * Each instance passes a **visibility** check (`Mesh3DData._worldVisible` — the item is in hand
   * anyway) and, when `cullFrustum` is given, a frustum test of its cached
   * `Mesh3DData.boundingSphere` (world-space for scene meshes, batch-local for
   * {@link BatchedMesh3D} instances — the planes move into that same frame once per batch, so
   * there is no per-instance matrix work). `radius < 0` (dynamic geometry, no bounds) always
   * survives.
   *
   * Survivors keep the command's original `firstInstance` base (gaps model — the draw reads
   * `[firstInstance, +instanceCount)`), so `firstInstance` is never rewritten and the source
   * ranges stay stable frame to frame. Only `instanceCount` is rebuilt.
   * @param list - The draw list whose staging index is walked
   * @param batch - The batch that owns the list; its store matrix sets the frame the planes move into
   * @param cullFrustum - World-space frustum to cull against, or `null` for a visibility-only walk
   * @param indexTexture - Receives the survivors' index texels
   */
  private _compact(
    list: DrawList,
    batch: Mesh3DBatch,
    cullFrustum: Frustum | null,
    indexTexture: RenderInstanceTexture,
  ): void {
    const glData = list.glData;
    const commandCount = list.commandList.count;
    const drawCalls = list.drawData.drawCalls;
    const totalInstances = glData.usedSlots;
    const items = list.view.items;
    const indices = list.view.indices;

    const src = glData.indexStaging!;
    const dst = indexTexture.data;

    // Six inward-facing test planes ([nx, ny, nz, c] x 6) in the batch's frame. Visibility-only
    // compactions never read them — the scratch stands in so the loop needs no null check.
    const planes =
      cullFrustum !== null ? transformFrustumToBatch(cullFrustum.planesData, batch.storeBuffer.data) : null;
    const tp = planes ?? _noPlanes;

    for (let k = 0; k < commandCount; k++) {
      const start = drawCalls[k * 5 + 4];
      const end = k + 1 < commandCount ? drawCalls[(k + 1) * 5 + 4] : totalInstances;
      // Survivors land contiguously from the command's stable base.
      let w = start;

      for (let i = start; i < end; i++) {
        const item = items[indices[i]];
        if (item._worldVisible === 0) continue;

        if (planes !== null) {
          const sphere = item.boundingSphere;
          const radius = sphere.radius;

          if (radius >= 0) {
            const center = sphere.center;
            const cx = center.x;
            const cy = center.y;
            const cz = center.z;

            // Outside any plane by more than the radius -> cull. Short-circuit `||`.
            if (
              tp[0] * cx + tp[1] * cy + tp[2] * cz + tp[3] < -radius ||
              tp[4] * cx + tp[5] * cy + tp[6] * cz + tp[7] < -radius ||
              tp[8] * cx + tp[9] * cy + tp[10] * cz + tp[11] < -radius ||
              tp[12] * cx + tp[13] * cy + tp[14] * cz + tp[15] < -radius ||
              tp[16] * cx + tp[17] * cy + tp[18] * cz + tp[19] < -radius ||
              tp[20] * cx + tp[21] * cy + tp[22] * cz + tp[23] < -radius
            ) {
              continue;
            }
          }
        }

        const sw = w * 4;
        const si = i * 4;
        dst[sw] = src[si];
        dst[sw + 1] = src[si + 1];
        dst[sw + 2] = src[si + 2];
        w++;
      }

      drawCalls[k * 5 + 1] = w - start;
    }

    indexTexture.upload();
    // Record which visibility state this walk consumed — `draw` dirty-gates the next
    // visibility-only run on it.
    list.glData.lastVisibilityDirtyId = batch._visibilityDirtyId;
  }

  /**
   * Grows this pass's index texture and its staging array to hold `needed` instances
   * @param list - The draw list whose index texture grows
   * @param needed - Instance count the texture must hold
   */
  private _ensureCapacity(list: DrawList, needed: number): void {
    const glData = list.glData;

    const indexTexture = (glData.indexTexture ??= new RenderInstanceTexture(Math.max(256, needed)));
    indexTexture.ensureCapacity(needed);
    // Staging matches the texture's padded length, so the compaction's source and
    // destination indices are the same arithmetic.
    if (!glData.indexStaging || glData.indexStaging.length < indexTexture.data.length) {
      glData.indexStaging = new Float32Array(indexTexture.data.length);
    }
  }

  private _recordCommand(
    commandList: DrawCommandList,
    drawData: DrawArgs,
    globalBindGroup: BindGroup,
    shader: Shader,
    state: Mesh3DData['material']['state'],
    geometry: Geometry,
    drawStart: number | undefined,
    drawSize: number | undefined,
    firstInstance: number,
    instanceCount: number,
    topology: Topology,
  ): void {
    const cmd = commandList.next();
    cmd.geometry = geometry;
    cmd.shader = shader;
    cmd.globalBindGroup = globalBindGroup;
    cmd.state = state;
    cmd.topology = topology;
    commandList.captureGeometry(geometry);
    const offset = (commandList.count - 1) * 5;
    const drawCalls = drawData.ensureCapacity(commandList.count);
    drawCalls[offset] = drawSize || geometry.indexCount || geometry.indexBuffer!.data.length;
    drawCalls[offset + 1] = instanceCount;
    drawCalls[offset + 2] = drawStart || 0;
    drawCalls[offset + 3] = 0; // WebGL rebases indices into the atlas; baseVertex unused.
    drawCalls[offset + 4] = firstInstance;
  }

  /**
   * Writes one instance's index texel: the mesh store row to read, and this pass's packed
   * texture slots
   *
   * Everything else about the instance — matrix, material index, bone / morph / geometry
   * lanes — already lives in the store row, so the pass records nothing but the pointer.
   * `RenderInstanceTexture` documents why the slots ride here, split into 16-bit halves.
   * @param index - The index texture's data
   * @param slot - Instance slot to write
   * @param r - The instance's mesh, whose store row the texel points at
   * @param packedSlots - This pass's packed texture slots for the instance
   */
  private _writeIndex(index: Float32Array, slot: number, r: Mesh3DData, packedSlots: number): void {
    const off = slot * 4;
    index[off] = r._storeIndex;
    index[off + 1] = packedSlots & 0xffff;
    index[off + 2] = (packedSlots >>> 16) & 0xffff;
  }

  private _packTextures(material: BaseMaterial3D, sources: BatchedTextureSource[], tick: number): number {
    const textures = material._textures;
    let packedSlots = 0;
    let slotCount = 0;

    for (let t = 0; t < textures.length; t++) {
      const src = textures[t].source as BatchedTextureSource;
      const uid = src.uid;
      let slot: number;

      if (uid <= 2) {
        slot = 13 + uid;
      } else if (src._batchTick === tick) {
        slot = src._batchSlot;
      } else {
        src._batchTick = tick;
        src._batchSlot = slotCount;
        sources[slotCount] = src;
        slot = slotCount;
        slotCount++;
      }

      packedSlots |= slot << (t * 4);
    }

    this._lastSlotCount = slotCount;
    return packedSlots;
  }

  private _commitTextures(textures: Texture[], sources: BatchedTextureSource[], tick: number): number {
    let packedSlots = 0;
    let slotCount = this._lastSlotCount;

    for (let t = 0; t < textures.length; t++) {
      const src = textures[t].source as BatchedTextureSource;
      const uid = src.uid;
      let slot: number;

      if (uid <= 2) {
        slot = 13 + uid;
      } else if (src._batchTick === tick) {
        slot = src._batchSlot;
      } else {
        src._batchTick = tick;
        src._batchSlot = slotCount;
        sources[slotCount] = src;
        slot = slotCount;
        slotCount++;
      }

      packedSlots |= slot << (t * 4);
    }

    this._lastSlotCount = slotCount;
    return packedSlots;
  }
}

/**
 * `batchTick` is module state shared across renderers, so it can only be reset
 * globally — `renderer.destroy({ releaseGlobalResources: true })` returns it to
 * its initial value.
 */
GlobalResourceRegistry.register({
  clear() {
    batchTick = 0;
  },
});
