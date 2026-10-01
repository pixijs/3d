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

/** Stands in for a geometry with no atlas allocation, so the build reads the same fields either way */
const noAlloc: {
  atlas: null;
  indexCount: undefined;
  firstIndex: undefined;
} = {
  atlas: null,
  indexCount: undefined,
  firstIndex: undefined,
};

/**
 * A texture source with the build's slot bookkeeping
 *
 * `_batchTick` is pixi's own `TextureSource` field, which pixi's 2D batcher also writes with its
 * own counter. `_batchSlot` is the source's slot in the bind group stamped `_batchTick`.
 */
interface BatchedTextureSource extends TextureSource {
  _batchTick: number;
  _batchSlot: number;
}

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
 * Texture batch counter, stamped on a texture source as `_batchTick` once the source has a slot in
 * the current bind group
 *
 * Each new bind group steps it by 2, so the fit probe in {@link Mesh3DBatcherGl#build} can stamp
 * the integer between, `tick + 1`, without matching any bind group's tick.
 *
 * Module state shared by every renderer, so only `renderer.destroy({ releaseGlobalResources: true })`
 * resets it, through `GlobalResourceRegistry`.
 */
let batchTick = 0;

/** Stands in for the plane array in a visibility-only compaction, which never tests against it */
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
 * Walks the sorted renderables, giving each mesh a stable slot `i`, writes its store row (plus
 * this pass's packed texture slots) into the index staging array at `i`, and records a
 * DrawCommandList with firstInstance/instanceCount per batch. Every command's base vertex is 0,
 * because the WebGL geometry atlas bakes it into the index values.
 *
 * ## Draw phase (every frame)
 * Compacts the staging array into the index texture, dropping hidden and frustum-culled
 * instances and rebuilding each command's instance count, uploads it, then issues the draws.
 * Without frustum culling, the compaction runs only when visibility changed. `firstInstance`
 * rides as one `uniform1i`, so a command needs no per-command vertex state at all.
 *
 * Index texel: `[storeIndex, packedSlots]`, 8 bytes per instance. Each texture takes a 4-bit slot
 * in `packedSlots`. The three built-in textures of one flat colour, `Texture.EMPTY`,
 * `Texture.WHITE` and `NORMAL_MAP` (the module checks their uids are 0, 1 and 2 when it loads),
 * take slot 13 + uid, which `texturesPluginGl` answers without a fetch, so they use up no batch
 * texture unit.
 * @see `Mesh3DBatcher`, the WebGPU equivalent
 * @see `MaterialSystemGl`, which owns the single GL batcher instance
 * @internal
 */
export class Mesh3DBatcherGl {
  /** Per-slot texture sources for the current batch, written into its texture bind group */
  private readonly _sources = Array.from<BatchedTextureSource>({ length: MAX_BATCH_TEXTURES });

  /** Slot count `_packTextures` and `_commitTextures` leave behind, so they needn't return a tuple */
  private _lastSlotCount = 0;

  /**
   * Build phase: walks the sorted renderables, writes each mesh's index texel, and records draw
   * commands
   *
   * After build, the mesh at sorted position `i` has its index texel at `i * 2` in the
   * pass's staging array. The draw compacts that into the texture.
   *
   * A run of meshes with the same `batchKey`, which carries shader, state, topology and geometry
   * exactly, is one draw command however long it gets: the index texture grows to fit. A mesh
   * whose key matches joins the run if its material's new textures fit in the free slots. A probe
   * counts them first, marking each with `tick + 1` so a texture listed twice counts once, and
   * only then are slots committed. When the key changes, the run's command is recorded, and the
   * next mesh still tries to fit the current slots, so several commands can share one texture
   * bind group. When the textures don't fit, the slots flush: the bind group is finished and
   * assigned to every command since the last flush, and a fresh tick starts the next set. Passes
   * that skip texture batching (depth, shadow, solid colour) sample no material textures, so they
   * build no bind group.
   *
   * Parks `lastVisibilityDirtyId` at -1, which no real dirty id matches, so the next draw
   * compacts the new index rather than trusting last frame's survivors.
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

    {
      const packedSlots = this._packTextures(r.material, sources, tick);
      slotCount = this._lastSlotCount;

      this._writeIndex(index, 0, r, packedSlots);
      prevMaterial = r.material;
      prevPackedSlots = packedSlots;
    }

    for (let i = 1; i < len; i++) {
      r = items[indices[i]];
      cache = r._passCache[passBit];

      const needsFlush = cache.batchKey !== currentBatchKey;

      if (!needsFlush) {
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
    list.glData.lastVisibilityDirtyId = -1;

    return len;
  }

  /**
   * Refreshes this pass's instance index if it can have changed, then issues its draws
   *
   * The compaction (`_compact`) drops hidden and out-of-frustum instances and rebuilds each
   * command's `instanceCount`; commands culled to nothing are skipped here. A list with no index
   * texture was never built for this batch and draws nothing.
   *
   * Without frustum culling, the compaction's answer can only change when something is hidden or
   * shown, which bumps the batch's visibility dirty id. On a frame where the id hasn't moved since
   * the last walk, last frame's texture and instance counts still stand, so the walk and its upload
   * are skipped; `build` parks the id at -1, so a rebuild always walks. Frustum culling can never
   * skip: the camera is one of its inputs and has no change signal. The gate also keeps the shadow
   * pass from repeating an identical walk once per cascade per light.
   *
   * `uInstanceBase` carries each command's `firstInstance`, which WebGL2 has no draw argument for.
   * A shader without `instanceFetchBitGl` has no such uniform, so the upload is skipped.
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
    if (!indexTexture) return;

    const frustumCull = cullFrustum !== null && list._cullProducer === 'cpu';

    if (frustumCull || list.glData.lastVisibilityDirtyId !== batch._visibilityDirtyId) {
      this._compact(list, batch, frustumCull ? cullFrustum : null, indexTexture);
    }

    const gl = (renderer as any).gl as WebGL2RenderingContext;
    const shaderSys = renderer.shader;
    const geoSys = renderer.geometry;
    const stateSys = renderer.state;

    const commandList = list.commandList;
    const commandCount = commandList.count;
    const drawCalls = list.drawData.drawCalls;

    for (let i = 0; i < commandCount; i++) {
      const b = i * 5;
      if (drawCalls[b + 1] === 0) continue;
      const cmd = commandList.commands[i];

      cmd.shader.groups[0] = cmd.globalBindGroup;
      cmd.shader.groups[1] = camera.bindGroup;
      if (cmd.batchBindGroup) cmd.shader.groups[2] = cmd.batchBindGroup;

      shaderSys.bind(cmd.shader);
      geoSys.bind(cmd.geometry, shaderSys._activeProgram);
      if (cmd.state) stateSys.set(cmd.state);

      const location = shaderSys._getProgramData(shaderSys._activeProgram).uniformData.uInstanceBase?.location;
      if (location !== undefined) gl.uniform1i(location, drawCalls[b + 4]);

      geoSys.draw(cmd.topology, drawCalls[b], drawCalls[b + 2], drawCalls[b + 1]);
    }
  }

  /**
   * Walks the build's staging index, drops hidden and out-of-frustum instances, and writes the
   * survivors into the index texture
   *
   * Each instance passes a **visibility** check (`Mesh3DData._worldVisible`, as the item is in
   * hand anyway) and, when `cullFrustum` is given, a frustum test of its cached
   * `Mesh3DData.boundingSphere`: world-space for scene meshes, batch-local for
   * {@link BatchedMesh3D} instances. The six inward-facing planes move into the batch's frame once
   * per batch, so there is no per-instance matrix work, and a sphere more than its radius outside
   * any plane is culled. `radius < 0` (dynamic geometry, no bounds) always survives.
   *
   * Survivors pack contiguously from the command's original `firstInstance`, and the draw reads
   * `[firstInstance, firstInstance + instanceCount)`, so `firstInstance` is never rewritten and
   * the source ranges stay stable frame to frame. Only `instanceCount` is rebuilt. The walk records
   * the visibility dirty id it consumed, which gates the next visibility-only walk in `draw`.
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

    const planes =
      cullFrustum !== null ? transformFrustumToBatch(cullFrustum.planesData, batch.storeBuffer.data) : null;
    const tp = planes ?? _noPlanes;

    for (let k = 0; k < commandCount; k++) {
      const start = drawCalls[k * 5 + 4];
      const end = k + 1 < commandCount ? drawCalls[(k + 1) * 5 + 4] : totalInstances;
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

        const sw = w * 2;
        const si = i * 2;
        dst[sw] = src[si];
        dst[sw + 1] = src[si + 1];
        w++;
      }

      drawCalls[k * 5 + 1] = w - start;
    }

    indexTexture.upload(totalInstances);
    list.glData.lastVisibilityDirtyId = batch._visibilityDirtyId;
  }

  /**
   * Grows this pass's index texture and its staging array to hold `needed` instances
   *
   * The staging array matches the texture's padded length, so the compaction indexes source and
   * destination the same way.
   * @param list - The draw list whose index texture grows
   * @param needed - Instance count the texture must hold
   */
  private _ensureCapacity(list: DrawList, needed: number): void {
    const glData = list.glData;

    const indexTexture = (glData.indexTexture ??= new RenderInstanceTexture(Math.max(256, needed)));
    indexTexture.ensureCapacity(needed);
    if (!glData.indexStaging || glData.indexStaging.length < indexTexture.data.length) {
      glData.indexStaging = new Uint32Array(indexTexture.data.length);
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
    drawCalls[offset + 3] = 0;
    drawCalls[offset + 4] = firstInstance;
  }

  /**
   * Writes one instance's index texel: the mesh store row to read, and this pass's packed
   * texture slots
   *
   * Everything else about the instance, its matrix, material index and bone, morph and geometry
   * lanes, already lives in the store row, so the pass records nothing but the pointer.
   * `RenderInstanceTexture` documents why the slots ride here.
   * @param index - The index texture's data
   * @param slot - Instance slot to write
   * @param r - The instance's mesh, whose store row the texel points at
   * @param packedSlots - This pass's packed texture slots for the instance
   */
  private _writeIndex(index: Uint32Array, slot: number, r: Mesh3DData, packedSlots: number): void {
    const off = slot * 2;
    index[off] = r._storeIndex;
    index[off + 1] = packedSlots;
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

GlobalResourceRegistry.register({
  clear() {
    batchTick = 0;
  },
});
