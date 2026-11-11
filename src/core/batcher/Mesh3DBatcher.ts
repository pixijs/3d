import type { BindGroup } from 'pixi.js';

import type { View3D } from '../../scene/View3D';
import type { DrawArgs } from '../buffers/DrawArgs';
import type { MaterialSystemGpu } from '../gpu/shader/MaterialSystemGpu';
import { MERGE_THRESHOLD } from './batchConstants';
import type { DrawCommandList } from './DrawCommandList';
import type { Mesh3DBatch } from './Mesh3DBatch';
import type { Mesh3DData } from './Mesh3DData';
import type { SortedMesh3DView } from './SortedMesh3DView';
import { pipelineState } from './updateMesh3DKeys';

interface BatcherRenderOptions {
  renderables: SortedMesh3DView<Mesh3DData>;
  globalBindGroup: BindGroup;
  commandList: DrawCommandList;
  drawData: DrawArgs;
  passBit: number;
  bindsMaterial: boolean;
  batch: Mesh3DBatch;
  view3d: View3D;
}

/**
 * Stands in for an unatlased geometry's allocation, so the walk reads one shape without a branch; a
 * real allocation's index count of 0 is kept, so an empty atlased geometry draws nothing
 */
const noAlloc = {
  atlas: null,
  indexCount: undefined,
  firstIndex: undefined,
  baseVertex: undefined,
};

/**
 * Turns a pass's sorted renderables into instanced WebGPU draw commands, one run at a time
 *
 * A run is a stretch of rows with one batch key and one texture set. In a pass that binds materials it
 * records a command per change of material, and draws merged once it needs more than `MERGE_THRESHOLD`.
 * @internal
 */
export class Mesh3DBatcher {
  private readonly _materialSystem: MaterialSystemGpu;

  constructor(materialSystem: MaterialSystemGpu) {
    this._materialSystem = materialSystem;
  }

  /**
   * Rebuilds `commandList` from the sorted renderables
   *
   * Each later material of a direct run refreshes its own bind group, since the capture at a run's
   * start refreshes only the first material's.
   */
  public render(options: BatcherRenderOptions): void {
    const { renderables, globalBindGroup, commandList, drawData, passBit, bindsMaterial, batch, view3d } = options;
    const len = renderables.count;
    if (len === 0) return;

    commandList.clear();

    const indices = renderables.indices;
    const items = renderables.items;
    const materialSystem = this._materialSystem;

    let r = items[indices[0]];
    let cache = r._passCache[passBit];
    let currentAlloc = r.geometry._geometryAtlasAllocation || noAlloc;
    let currentBatchKey = cache.batchKey;
    let currentGeometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : r.geometry;
    let currentShader = cache.shader;
    let currentState = pipelineState(currentBatchKey, cache.state);
    let currentTopology = cache.topology;
    let currentMaterial = r.material;

    let batchStart = 0;
    let runStart = 0;
    let runCommandStart = 0;
    let runFirstMaterial = currentMaterial;
    let merged = false;

    if (bindsMaterial) commandList.captureMaterialTextures(currentMaterial);

    for (let i = 1; i < len; i++) {
      r = items[indices[i]];
      cache = r._passCache[passBit];

      const rBatchKey = cache.batchKey;
      const m = r.material;
      const keyChanged = rBatchKey !== currentBatchKey;

      if (!keyChanged && (!bindsMaterial || m === currentMaterial)) continue;

      const sameRun = !keyChanged && currentMaterial._textureSetId === m._textureSetId;
      if (sameRun) {
        if (merged) {
          currentMaterial = m;
          continue;
        }
        const commandsWithNewMaterial = commandList.count - runCommandStart + 2;
        if (commandsWithNewMaterial > MERGE_THRESHOLD) {
          commandList.count = runCommandStart;
          batchStart = runStart;
          merged = true;
          currentShader = materialSystem.ensureMergedShader(items[indices[runStart]], batch, view3d);
          currentMaterial = m;
          continue;
        }
      }

      const cmd = commandList.next();
      cmd.geometry = currentGeometry;
      cmd.shader = currentShader;
      cmd.globalBindGroup = globalBindGroup;
      cmd.batchBindGroup = bindsMaterial
        ? merged
          ? runFirstMaterial._getMergedBindGroup()
          : currentMaterial._getBindGroup()
        : undefined;
      cmd.state = currentState;
      cmd.topology = currentTopology;
      cmd.batchKey = currentBatchKey;
      cmd.textureSetId = bindsMaterial ? runFirstMaterial._textureSetId : 0;
      cmd.merged = bindsMaterial && merged;
      commandList.captureGeometry(currentGeometry);
      const offset = (commandList.count - 1) * 5;
      const drawCalls = drawData.ensureCapacity(commandList.count);
      drawCalls[offset] =
        currentAlloc.indexCount ?? (currentGeometry.indexCount || currentGeometry.indexBuffer.data.length);
      drawCalls[offset + 1] = i - batchStart;
      drawCalls[offset + 2] = currentAlloc.firstIndex || 0;
      drawCalls[offset + 3] = currentAlloc.baseVertex || 0;
      drawCalls[offset + 4] = batchStart;

      batchStart = i;
      const materialChanged = m !== currentMaterial;
      currentMaterial = m;

      if (!sameRun) {
        if (keyChanged) {
          currentAlloc = r.geometry._geometryAtlasAllocation || noAlloc;
          currentBatchKey = rBatchKey;
          currentGeometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : r.geometry;
          currentState = pipelineState(rBatchKey, cache.state);
          currentTopology = cache.topology;
        }
        currentShader = cache.shader;
        runStart = i;
        runCommandStart = commandList.count;
        runFirstMaterial = m;
        merged = false;
      }

      if (bindsMaterial && materialChanged) {
        if (sameRun) commandList.refreshMaterialBindings(m);
        else commandList.captureMaterialTextures(m);
      }
    }

    {
      const cmd = commandList.next();
      cmd.geometry = currentGeometry;
      cmd.shader = currentShader;
      cmd.globalBindGroup = globalBindGroup;
      cmd.batchBindGroup = bindsMaterial
        ? merged
          ? runFirstMaterial._getMergedBindGroup()
          : currentMaterial._getBindGroup()
        : undefined;
      cmd.state = currentState;
      cmd.topology = currentTopology;
      cmd.batchKey = currentBatchKey;
      cmd.textureSetId = bindsMaterial ? runFirstMaterial._textureSetId : 0;
      cmd.merged = bindsMaterial && merged;
      commandList.captureGeometry(currentGeometry);
      const offset = (commandList.count - 1) * 5;
      const drawCalls = drawData.ensureCapacity(commandList.count);
      drawCalls[offset] =
        currentAlloc.indexCount ?? (currentGeometry.indexCount || currentGeometry.indexBuffer.data.length);
      drawCalls[offset + 1] = len - batchStart;
      drawCalls[offset + 2] = currentAlloc.firstIndex || 0;
      drawCalls[offset + 3] = currentAlloc.baseVertex || 0;
      drawCalls[offset + 4] = batchStart;
    }

    commandList.endBuild();
  }
}
