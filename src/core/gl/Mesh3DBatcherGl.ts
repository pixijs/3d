import { UniformGroup } from 'pixi.js';
import type { BindGroup, Geometry, Shader, Topology, WebGLRenderer } from 'pixi.js';

import { Matrix4 } from '../../math/matrix/Matrix4';
import type { Frustum } from '../../math/misc/Frustum';
import type { DrawCommandList } from '../batcher/DrawCommandList';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { pipelineState } from '../batcher/updateMesh3DKeys';
import type { DrawArgs } from '../buffers/DrawArgs';
import { MESH3D_SPHERE_STRIDE } from '../buffers/Mesh3DDataStoreBuffer';
import { RenderInstanceTexture } from '../buffers/RenderInstanceTexture';
import type { CameraData } from '../CameraData';
import { transformFrustumToBatch } from '../cull';
import type { DrawList } from '../render-passes/DrawList';

interface GlBatcherBuildOptions {
  renderables: SortedMesh3DView<Mesh3DData>;
  list: DrawList;
  globalBindGroup: BindGroup;
  passBit: number;
  bindsMaterial: boolean;
}

const noAlloc: {
  atlas: null;
  indexCount: undefined;
  firstIndex: undefined;
} = {
  atlas: null,
  indexCount: undefined,
  firstIndex: undefined,
};

const _noPlanes = new Float32Array(24);

/**
 * Every run that binds a material draws merged, the form `MaterialSystemGl.ensureMaterial` compiles. Commands draw
 * with a base vertex of 0, since the WebGL atlas bakes it into the indices (`GeometryAtlas.rebaseIndices`).
 * @internal
 */
export class Mesh3DBatcherGl {
  /**
   * The group `instanceFetchBitGl` declares, shared by every batch and set by each `draw`: pixi re-uploads a static
   * group to a program only when it changed since that program read it, so per-batch groups could draw a stale matrix
   */
  public readonly batchTransform = new UniformGroup(
    { uBatchWorldMatrix: { value: new Matrix4(), type: 'mat4x4<f32>' } },
    { isStatic: true, ubo: false },
  );

  /**
   * Parks `lastVisibilityDirtyId` at -1, which no dirty id matches, so the next draw compacts the new index
   * @returns The number of instances written
   */
  public build(options: GlBatcherBuildOptions): number {
    const { renderables, list, globalBindGroup, passBit, bindsMaterial } = options;
    const len = renderables.count;
    const commandList = list.commandList;

    if (len === 0) return 0;

    commandList.clear();
    this._ensureCapacity(list, len);

    const indices = renderables.indices;
    const items = renderables.items;
    const glData = list.glData;
    const index = glData.indexStaging!;

    let r = items[indices[0]];
    let cache = r._passCache[passBit];
    let currentShader = cache.shader;
    let currentBatchKey = cache.batchKey;
    let currentGeometry = r.geometry;
    let currentState = pipelineState(currentBatchKey, cache.state);
    let currentTopology = cache.topology;
    let currentMaterial = r.material;

    let currentAlloc = currentGeometry._geometryAtlasAllocation || noAlloc;
    let geometry: Geometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : currentGeometry;
    let drawStart = currentAlloc.firstIndex;
    let drawSize = currentAlloc.indexCount;

    let batchStart = 0;
    let runFirstMaterial = currentMaterial;

    if (bindsMaterial) commandList.captureMaterialTextures(currentMaterial);
    index[0] = r._storeIndex;

    for (let i = 1; i < len; i++) {
      r = items[indices[i]];
      cache = r._passCache[passBit];
      index[i] = r._storeIndex;

      const m = r.material;
      const keyChanged = cache.batchKey !== currentBatchKey;

      if (!keyChanged && (!bindsMaterial || m === currentMaterial)) continue;

      const sameRun = !keyChanged && currentMaterial._textureSetId === m._textureSetId;
      if (sameRun) {
        currentMaterial = m;
        continue;
      }

      this._recordCommand(
        commandList,
        list.drawData,
        globalBindGroup,
        bindsMaterial ? runFirstMaterial._getMergedBindGroup() : undefined,
        currentShader,
        currentState,
        geometry,
        drawStart,
        drawSize,
        batchStart,
        i - batchStart,
        currentTopology,
        currentBatchKey,
        bindsMaterial ? runFirstMaterial._textureSetId : 0,
        bindsMaterial,
      );

      batchStart = i;
      const materialChanged = m !== currentMaterial;
      currentMaterial = m;

      if (keyChanged) {
        currentBatchKey = cache.batchKey;
        currentGeometry = r.geometry;
        currentShader = cache.shader;
        currentState = pipelineState(currentBatchKey, cache.state);
        currentTopology = cache.topology;

        currentAlloc = currentGeometry._geometryAtlasAllocation || noAlloc;
        geometry = currentAlloc.atlas ? currentAlloc.atlas.geometry : currentGeometry;
        drawStart = currentAlloc.firstIndex;
        drawSize = currentAlloc.indexCount;
      }
      runFirstMaterial = m;

      if (bindsMaterial && materialChanged) commandList.captureMaterialTextures(m);
    }

    this._recordCommand(
      commandList,
      list.drawData,
      globalBindGroup,
      bindsMaterial ? runFirstMaterial._getMergedBindGroup() : undefined,
      currentShader,
      currentState,
      geometry,
      drawStart,
      drawSize,
      batchStart,
      len - batchStart,
      currentTopology,
      currentBatchKey,
      bindsMaterial ? runFirstMaterial._textureSetId : 0,
      bindsMaterial,
    );

    commandList.endBuild();

    glData.lastVisibilityDirtyId = -1;

    return len;
  }

  /**
   * Frustum culling compacts every draw, since the camera has no change signal; otherwise only a rebuild or a
   * visibility change does. Skips a command with no indices, which pixi would draw as the whole index buffer.
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

    const frustumCull = cullFrustum !== null && batch.cull !== 'off';

    if (frustumCull || list.glData.lastVisibilityDirtyId !== batch._visibilityDirtyId) {
      this._compact(list, batch, frustumCull ? cullFrustum : null, indexTexture);
    }

    this.batchTransform.uniforms.uBatchWorldMatrix = batch.renderData.worldTransform;
    this.batchTransform.update();

    const gl = renderer.gl;
    const shaderSys = renderer.shader;
    const geoSys = renderer.geometry;
    const stateSys = renderer.state;

    const commandList = list.commandList;
    const commandCount = commandList.count;
    const drawCalls = list.drawData.drawCalls;

    for (let i = 0; i < commandCount; i++) {
      const b = i * 5;
      if (drawCalls[b + 1] === 0 || drawCalls[b] === 0) continue;
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
   * Survivors pack from each command's `firstInstance`, which never moves, since it also bounds the command's staging
   * range. Writes only texels that differ from `indexTexture.data`, which mirrors the GPU copy, and uploads their span.
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
    const totalInstances = list.view.count;
    const visible = batch.storeBuffer.visible;
    if (cullFrustum !== null) batch._ensureSpheres();
    const spheres = batch.storeBuffer.boundingSpheres as Float32Array;

    const src = glData.indexStaging!;
    const dst = indexTexture.data;

    const planes =
      cullFrustum !== null ? transformFrustumToBatch(cullFrustum.planesData, batch.storeBuffer.data) : null;
    const tp = planes ?? _noPlanes;
    let changedStart = totalInstances;
    let changedEnd = 0;

    for (let k = 0; k < commandCount; k++) {
      const start = drawCalls[k * 5 + 4];
      const end = k + 1 < commandCount ? drawCalls[(k + 1) * 5 + 4] : totalInstances;
      let w = start;

      for (let i = start; i < end; i++) {
        const id = src[i];
        if (visible[id] === 0) continue;

        if (planes !== null) {
          const so = id * MESH3D_SPHERE_STRIDE;
          const radius = spheres[so + 3];

          if (radius >= 0) {
            const cx = spheres[so];
            const cy = spheres[so + 1];
            const cz = spheres[so + 2];

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

        if (dst[w] !== id) {
          dst[w] = id;
          if (w < changedStart) changedStart = w;
          changedEnd = w + 1;
        }
        w++;
      }

      drawCalls[k * 5 + 1] = w - start;
    }

    indexTexture.upload(changedStart, changedEnd);
    list.glData.lastVisibilityDirtyId = batch._visibilityDirtyId;
  }

  /** Drops the records on growth, so only `build`, which rewrites every one, may call it */
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
    bindGroup: BindGroup | undefined,
    shader: Shader,
    state: Mesh3DData['material']['state'],
    geometry: Geometry,
    drawStart: number | undefined,
    drawSize: number | undefined,
    firstInstance: number,
    instanceCount: number,
    topology: Topology,
    batchKey: number,
    textureSetId: number,
    merged: boolean,
  ): void {
    const cmd = commandList.next();
    cmd.geometry = geometry;
    cmd.shader = shader;
    cmd.globalBindGroup = globalBindGroup;
    cmd.batchBindGroup = bindGroup;
    cmd.state = state;
    cmd.topology = topology;
    cmd.batchKey = batchKey;
    cmd.textureSetId = textureSetId;
    cmd.merged = merged;
    commandList.captureGeometry(geometry);
    const offset = (commandList.count - 1) * 5;
    const drawCalls = drawData.ensureCapacity(commandList.count);
    drawCalls[offset] = drawSize ?? (geometry.indexCount || geometry.indexBuffer.data.length);
    drawCalls[offset + 1] = instanceCount;
    drawCalls[offset + 2] = drawStart ?? 0;
    drawCalls[offset + 3] = 0;
    drawCalls[offset + 4] = firstInstance;
  }
}
