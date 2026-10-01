import { GlobalResourceRegistry, Texture } from 'pixi.js';
import type { BindGroup, TextureSource } from 'pixi.js';

import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import type { DrawArgs } from '../buffers/DrawArgs';
import { NORMAL_MAP } from '../textures/DefaultTextures';
import { MAX_BATCH_TEXTURES } from './batchConstants';
import type { DrawCommandList } from './DrawCommandList';
import type { Mesh3DData } from './Mesh3DData';
import type { SortedMesh3DView } from './SortedMesh3DView';

/**
 * Inputs for one `Mesh3DBatcher.render` walk
 * @internal
 */
interface BatcherRenderOptions {
  /** Sorted view of the renderables to batch, in draw order */
  renderables: SortedMesh3DView<Mesh3DData>;
  /** Global bind group assigned to every emitted command's `globalBindGroup` */
  globalBindGroup: BindGroup;
  /**
   * Interleaved instance records, `[storeIndex, packedTextureSlots]` per instance
   *
   * `populateIds` has already written the store indices and sized the array for every renderable.
   * The batcher writes the packed texture slots into the odd entries, `instanceData[i * 2 + 1]`.
   */
  instanceData: Uint32Array;
  /** Receives the draw commands */
  commandList: DrawCommandList;
  /** Receives each command's numeric draw args, grown as needed */
  drawData: DrawArgs;
  /** The pass whose `_passCache` entry supplies each renderable's shader, state, topology and batch key */
  passBit: number;
  /** Skips texture slot packing and the batch texture bind group, for a pass that samples no material textures */
  skipTextureBatching?: boolean;
}

/**
 * Stands in for the atlas allocation of a geometry that has none, so the hot loop reads
 * `indexCount`, `firstIndex` and `baseVertex` without a branch
 *
 * All three are `undefined`. A `u32` draw arg can't carry `undefined` the way pixi's own draw call
 * does, so `render` resolves them to the geometry's own index count and to zero offsets.
 */
const noAlloc = {
  atlas: null,
  indexCount: undefined,
  firstIndex: undefined,
  baseVertex: undefined,
};

/**
 * Texture batch counter, stamped on a texture source as `_batchTick` once the source has a slot in
 * the current bind group
 *
 * Each new bind group steps it by 2, so the fit probe in {@link Mesh3DBatcher#render} can stamp the
 * integer between, `tick + 1`, without matching any bind group's tick.
 *
 * Module state shared by every renderer, so only `renderer.destroy({ releaseGlobalResources: true })`
 * resets it, through `GlobalResourceRegistry`.
 */
let batchTick = 0;

/**
 * A texture source with the fields the batcher stamps on it
 *
 * `_batchTick` is pixi's own `TextureSource` field, which pixi's 2D batcher also writes with its own
 * counter. `_batchSlot` is the source's slot in the bind group stamped `_batchTick`.
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
 * Turns a pass's sorted renderables into instanced WebGPU draw commands
 *
 * `MaterialSystemGpu` owns the one instance; `Mesh3DBatcherGl` is the WebGL counterpart.
 *
 * The pass sorts its renderables by `_sortKey` first, which puts meshes that share a pipeline and a
 * geometry next to each other (`updateMesh3DKeys` lays the key out). The batcher walks that order and
 * starts a new draw command whenever `batchKey` changes, so each run of equal keys becomes one
 * instanced draw.
 *
 * Draw commands and texture bind groups break independently. A new draw command keeps filling the
 * current bind group. The group is finalised only when the next material's textures don't fit, or
 * the walk ends, and every command since the last group then gets it. Consecutive draws whose
 * textures fit in `MAX_BATCH_TEXTURES` slots share one bind group.
 *
 * Each distinct texture source in a bind group gets a slot. A material's slots pack into one `u32`,
 * 4 bits per texture in `_textures` order, so a material can have at most eight textures. The
 * batcher writes that `u32` into the mesh's instance record, and the shader unpacks it to pick the
 * slot each texture samples. A mesh with the same material as the one before it reuses its packed
 * value without looking at the textures.
 *
 * `Texture.EMPTY` (uid 0), `Texture.WHITE` (uid 1) and `NORMAL_MAP` (uid 2) pack as slots 13 to 15
 * and never take a slot. The module throws on load if those uids ever change.
 * @internal
 */
export class Mesh3DBatcher {
  /** The texture source in each slot of the current bind group */
  private readonly _sources = Array.from<BatchedTextureSource>({ length: MAX_BATCH_TEXTURES });

  /**
   * Walks the sorted renderables and emits instanced draw commands
   *
   * Before a mesh's textures join the current bind group, a probe counts the sources not in it yet,
   * stamping each with `tick + 1` so a source the material lists twice counts once. If they fit,
   * `_commitTextures` gives them slots; if not, the group is finalised and a new one starts.
   * @param options - Sources and destinations for the walk.
   */
  public render(options: BatcherRenderOptions): void {
    const { renderables, globalBindGroup, instanceData, commandList, drawData, passBit, skipTextureBatching } = options;
    const len = renderables.count;
    if (len === 0) return;

    commandList.clear();

    const indices = renderables.indices;
    const items = renderables.items;

    const dst = instanceData;

    const sources = this._sources;

    let batchStart = 0;
    let texBatchStart = 0;
    let r = items[indices[0]];
    let cache = r._passCache[passBit];
    let currentAlloc = r.geometry._geometryAtlasAllocation || noAlloc;
    let currentBatchKey = cache.batchKey;
    let currentGeometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : r.geometry;
    let currentShader = cache.shader;
    let currentState = cache.state;
    let currentTopology = cache.topology;

    let tick = (batchTick += 2);
    let slotCount = 0;
    let prevMaterial: BaseMaterial3D | null = null;
    let prevPackedSlots = 0;

    prevPackedSlots = this._packTextures(r.material, sources, tick);
    dst[1] = prevPackedSlots;
    slotCount = this._lastSlotCount;
    prevMaterial = r.material;

    for (let i = 1; i < len; i++) {
      r = items[indices[i]];
      cache = r._passCache[passBit];

      const rBatchKey = cache.batchKey;
      const needsFlush = rBatchKey !== currentBatchKey;

      if (!needsFlush) {
        const m = r.material;

        if (m === prevMaterial) {
          dst[i * 2 + 1] = prevPackedSlots;
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
          prevPackedSlots = this._commitTextures(textures, sources, tick);
          dst[i * 2 + 1] = prevPackedSlots;
          slotCount = this._lastSlotCount;
          prevMaterial = m;
          continue;
        }
      }

      const cmd = commandList.next();
      cmd.geometry = currentGeometry;
      cmd.shader = currentShader!;
      cmd.globalBindGroup = globalBindGroup;
      cmd.batchBindGroup = undefined;
      cmd.state = currentState;
      cmd.topology = currentTopology;
      commandList.captureGeometry(currentGeometry);
      const offset = (commandList.count - 1) * 5;
      const drawCalls = drawData.ensureCapacity(commandList.count);
      drawCalls[offset] =
        currentAlloc.indexCount || currentGeometry.indexCount || currentGeometry.indexBuffer!.data.length;
      drawCalls[offset + 1] = i - batchStart;
      drawCalls[offset + 2] = currentAlloc.firstIndex || 0;
      drawCalls[offset + 3] = currentAlloc.baseVertex || 0;
      drawCalls[offset + 4] = batchStart;

      batchStart = i;
      currentAlloc = r.geometry._geometryAtlasAllocation || noAlloc;
      currentBatchKey = rBatchKey;
      currentGeometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : r.geometry;
      currentShader = cache.shader;
      currentState = cache.state;
      currentTopology = cache.topology;

      if (needsFlush) {
        const m = r.material;

        if (m === prevMaterial) {
          dst[i * 2 + 1] = prevPackedSlots;
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
          prevPackedSlots = this._commitTextures(textures, sources, tick);
          dst[i * 2 + 1] = prevPackedSlots;
          slotCount = this._lastSlotCount;
          prevMaterial = m;
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

      prevPackedSlots = this._packTextures(r.material, sources, tick);
      dst[i * 2 + 1] = prevPackedSlots;
      slotCount = this._lastSlotCount;
      prevMaterial = r.material;
    }

    {
      const cmd = commandList.next();
      cmd.geometry = currentGeometry;
      cmd.shader = currentShader!;
      cmd.globalBindGroup = globalBindGroup;
      cmd.batchBindGroup = undefined;
      cmd.state = currentState;
      cmd.topology = currentTopology;
      commandList.captureGeometry(currentGeometry);
      const offset = (commandList.count - 1) * 5;
      const drawCalls = drawData.ensureCapacity(commandList.count);
      drawCalls[offset] =
        currentAlloc.indexCount || currentGeometry.indexCount || currentGeometry.indexBuffer!.data.length;
      drawCalls[offset + 1] = len - batchStart;
      drawCalls[offset + 2] = currentAlloc.firstIndex || 0;
      drawCalls[offset + 3] = currentAlloc.baseVertex || 0;
      drawCalls[offset + 4] = batchStart;
    }

    if (!skipTextureBatching) {
      const bg = commandList.nextBatchBindGroup(sources, slotCount);
      const cmds = commandList.commands;
      for (let c = texBatchStart; c < commandList.count; c++) {
        cmds[c].batchBindGroup = bg;
      }
    }

    commandList.endBuild();
  }

  /**
   * Slots the current bind group holds after the last `_packTextures` or `_commitTextures`
   *
   * `_commitTextures` continues from it. A field rather than a second return value, so neither
   * per-mesh call allocates.
   */
  private _lastSlotCount = 0;

  /**
   * Gives a material's textures slots in a new bind group, counting from slot 0, and returns them
   * packed 4 bits per texture, texture 0 in the lowest bits
   *
   * `_commitTextures` adds to the current bind group instead.
   * @param material - The material whose textures get slots
   * @param sources - Receives each newly slotted source at its slot index
   * @param tick - Current batch tick; a source already stamped with it keeps its slot
   */
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

  /**
   * Gives textures slots in the current bind group, continuing from `_lastSlotCount`, and returns
   * them packed like `_packTextures`
   *
   * `render` calls it once the probe has shown the new sources fit. The probe stamped them
   * `tick + 1`; this stamps `tick`.
   * @param textures - Textures to slot into the current batch
   * @param sources - Receives each newly slotted source at its slot index
   * @param tick - Current batch tick, stamped on each newly slotted source
   */
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
