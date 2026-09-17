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
   * Interleaved instance buffer data. The batcher writes packed texture slots
   * to the odd halves (`instanceData[i*2 + 1]`); pre-sized by populateIds.
   */
  instanceData: Uint32Array;
  /** Destination command list — the batcher writes the per-command state here */
  commandList: DrawCommandList;
  /** Destination indirect-draw args — the batcher writes the numeric draw-call lanes here (grown as needed) */
  drawData: DrawArgs;
  /** Which pass to read shader/state/batchKey from: `_passCache[passBit]` */
  passBit: number;
  /** When true, skip texture slot packing and the batch texture bind group (batchBindGroup) */
  skipTextureBatching?: boolean;
}

/**
 * Null-object for meshes without a geometry atlas allocation
 * Avoids branching in the hot loop — the batcher can unconditionally
 * read `.indexCount`, `.firstIndex`, `.baseVertex` (all `undefined`,
 * which the draw command interprets as "use full geometry").
 */
const noAlloc = {
  atlas: null,
  indexCount: undefined,
  firstIndex: undefined,
  baseVertex: undefined,
};

/**
 * Monotonically increasing tick used to track which texture sources have
 * already been assigned a slot in the current batch. Incremented by 2 for
 * each new batch so that the speculative probe (`tick + 1`) stays an
 * integer, keeping all `_batchTick` values as V8 Smis.
 */
let batchTick = 0;

// Extend TextureSource with batch tracking fields (PixiJS does the same thing)
interface BatchedTextureSource extends TextureSource {
  _batchTick: number;
  _batchSlot: number;
}

// The reserved-slot mapping (uid <= 2 → fixed slots 13-15) relies on these
// built-in textures being created first, so fail fast if the uids ever shift.
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
 * Batches 3D meshes for WebGPU instanced rendering
 *
 * Owned as a single instance by `MaterialSystemGpu`; emits into a
 * `DrawCommandList`.
 *
 * ## How it works
 *
 * The render passes (opaque / transparent) pre-sort renderables by `_sortKey`
 * which encodes `textureLayoutId | pipeline | geometry | texture` in
 * descending priority. This batcher walks the sorted list and groups
 * consecutive items that share the same `_batchKey` (pipeline+geometry) into
 * instanced draw commands, packing texture sources into a fixed-size slot
 * array (up to `MAX_BATCH_TEXTURES`).
 *
 * Draw command boundaries and texture bind group boundaries are **decoupled**:
 * a geometry/pipeline change emits a new draw command but keeps accumulating
 * textures into the current bind group. The bind group is only finalised when
 * the texture slots actually overflow (or the list ends), then back-assigned
 * to every pending draw command. This means consecutive draws that fit within
 * the same texture budget share a single bind group, reducing setBindGroup
 * calls during replay.
 *
 * ## Texture slot packing
 *
 * Each material exposes a flat `_textures: Texture[]` array. The batcher
 * iterates this array generically (no material-specific code) and assigns
 * each unique `TextureSource` to a batch slot (0–13). The slot indices are
 * packed into a single `u32` (4 bits per texture, up to 8 textures per
 * material) and written to the texture-slot half of the interleaved instance
 * buffer (`instanceData[i*2 + 1]`). The shader unpacks them at runtime via
 * bit-shift to sample the correct batch texture.
 *
 * ## prevMaterial optimisation
 *
 * Because the list is sorted, consecutive items often share the same material.
 * When `material === prevMaterial` we reuse the previously packed slot u32
 * without touching the texture arrays at all — the fastest path.
 *
 * ## Reserved texture UIDs
 *
 * `Texture.EMPTY` (uid 0), `Texture.WHITE` (uid 1), and `NORMAL_MAP` (uid 2)
 * are mapped to fixed slots 13–15, bypassing the dynamic slot allocator.
 * This means default/placeholder textures never consume a batch slot.
 * @internal
 */
export class Mesh3DBatcher {
  /** Per-slot texture sources for the current batch — written into the BindGroup */
  private readonly _sources = Array.from<BatchedTextureSource>({ length: MAX_BATCH_TEXTURES });

  /**
   * Walk the sorted renderable list and emit instanced draw commands
   *
   * See the class docs for the batching strategy: decoupled draw / bind-group
   * boundaries, texture slot packing, and the prevMaterial fast path.
   * @param options - Sources and destinations for the walk.
   */
  public render(options: BatcherRenderOptions): void {
    const { renderables, globalBindGroup, instanceData, commandList, drawData, passBit, skipTextureBatching } = options;
    const len = renderables.count;
    if (len === 0) return;

    commandList.clear();

    const indices = renderables.indices;
    const items = renderables.items;

    // Texture-slot halves live at odd offsets (`[i*2 + 1]`); the id halves are
    // pre-written by populateIds and the buffer is pre-sized for `len` instances,
    // so there is no resize here.
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

    // BATCH_TICK: increment by 2 so the speculative probe (tick + 1) stays
    // an integer, keeping all _batchTick values as V8 Smis.
    let tick = (batchTick += 2);
    let slotCount = 0;
    let prevMaterial: BaseMaterial3D | null = null;
    let prevPackedSlots = 0;

    // --- Process first mesh (always starts a batch) ---
    prevPackedSlots = this._packTextures(r.material, sources, tick);
    dst[1] = prevPackedSlots;
    slotCount = this._lastSlotCount;
    prevMaterial = r.material;

    // --- Main render loop ---
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

        // Speculate: can we fit this item's textures into the remaining slots?
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

      // --- DRAW FLUSH ---
      // Emit a draw command for the previous instance range.
      // batchBindGroup is deferred — assigned when the texture batch finalises.

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

      // When the batch key changed, try to keep the current texture bind
      // group alive so multiple draw commands share it.
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

      // --- TEXTURE FLUSH ---
      // Slots are full. Finalise the bind group and back-assign it to every
      // draw command emitted since the last texture flush.
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

    // --- Final flush ---
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

  // Scratch field — avoids returning a tuple from _packTextures / _commitTextures.
  // Only read immediately after the call, never across a yield point.
  private _lastSlotCount = 0;

  /**
   * Assign batch slots to all of a material's textures
   *
   * Returns the packed u32 where each texture's slot occupies 4 bits
   * (bits 0-3 = texture 0, bits 4-7 = texture 1, etc.).
   *
   * Resets the internal slot counter — call this when starting a **new batch**.
   * For adding textures to an existing batch, use `_commitTextures` instead.
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
   * Assign batch slots to textures, **continuing** from the current slot count
   *
   * Returns the packed u32. Called mid-batch after the speculative fit check
   * (`slotCount + needed <= MAX_BATCH_TEXTURES`) confirms the textures fit.
   *
   * The speculative probe (`probeTick = tick + 1`) marks sources as "maybe
   * assigned" without committing. This method finalises the assignment by
   * stamping the real `tick` on each source.
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
