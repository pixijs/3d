import type { Matrix4 } from '../../../math/matrix/Matrix4';
import type { Vector3 } from '../../../math/vector/Vector3';
import type { Mesh3DData } from '../../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../../batcher/SortedMesh3DView';
import { MESH3D_STORE_STRIDE } from '../../buffers/Mesh3DDataStoreBuffer';

/**
 * Sorts a batch's blended meshes back to front by their squared distance from the camera, for
 * WebGPU
 *
 * Each mesh's position is lanes 12 to 14 of its store row, the translation of the matrix that
 * starts the row: a world matrix in the scene batch, but a batch-local one in a
 * {@link BatchedMesh3D}'s. The key is the negated distance, so the ascending sort puts the
 * farthest first, and the sort is forced because the keys change every frame. It doesn't cull:
 * the passes run their usual compaction on the draw data afterwards.
 * @param renderables - The pass view of transparent meshes to sort.
 * @param transformData - The batch's store buffer data, one matrix per row.
 * @param cameraPos - The position of the camera in world space.
 * @internal
 */
export function calculateTransparentDistances(
  renderables: SortedMesh3DView<Mesh3DData>,
  transformData: Float32Array,
  cameraPos: Vector3,
): void {
  const camX = cameraPos.x;
  const camY = cameraPos.y;
  const camZ = cameraPos.z;

  const items = renderables.items;
  const renderableIndices = renderables.renderableIndices;
  const count = renderables.count;

  for (let i = 0; i < count; i++) {
    const renderable = items[renderableIndices[i]]!;

    const matrixOffset = renderable._storeIndex * MESH3D_STORE_STRIDE;

    const dx = transformData[matrixOffset + 12] - camX;
    const dy = transformData[matrixOffset + 13] - camY;
    const dz = transformData[matrixOffset + 14] - camZ;

    const distSq = dx * dx + dy * dy + dz * dz;

    renderable._sortKey = -distSq;
  }

  renderables.sortForced((m) => m._sortKey);
}

/**
 * Sorts the scene batch's blended meshes back to front, on WebGL
 *
 * Reads each mesh's world matrix translation, and keys it as {@link calculateTransparentDistances}
 * does.
 * @param renderables - The meshes to sort back to front
 * @param cameraPos - World-space camera position
 * @internal
 */
export function calculateDistancesFromWorldMatrix(renderables: SortedMesh3DView<Mesh3DData>, cameraPos: Vector3): void {
  const camX = cameraPos.x;
  const camY = cameraPos.y;
  const camZ = cameraPos.z;

  const items = renderables.items;
  const renderableIndices = renderables.renderableIndices;
  const count = renderables.count;

  for (let i = 0; i < count; i++) {
    const renderable = items[renderableIndices[i]]! as any;
    const e = renderable.worldTransform.elements;

    const dx = e[12] - camX;
    const dy = e[13] - camY;
    const dz = e[14] - camZ;

    renderable._sortKey = -(dx * dx + dy * dy + dz * dz);
  }

  renderables.sortForced((m) => m._sortKey);
}

/**
 * Sorts a {@link BatchedMesh3D}'s blended items back to front, on WebGL
 *
 * Reads each item's local position from its store row and moves it into the world by the batch's
 * world matrix, then keys it as {@link calculateTransparentDistances} does.
 * @param renderables - The batch items to sort back to front
 * @param cameraPos - World-space camera position
 * @param storeF32 - The batch's store buffer, holding each item's local matrix
 * @param batchMatrix - The batch's world matrix
 * @internal
 */
export function calculateDistancesFromStore(
  renderables: SortedMesh3DView<Mesh3DData>,
  cameraPos: Vector3,
  storeF32: Float32Array,
  batchMatrix: Matrix4,
): void {
  const camX = cameraPos.x;
  const camY = cameraPos.y;
  const camZ = cameraPos.z;
  const bm = batchMatrix.elements;

  const items = renderables.items;
  const renderableIndices = renderables.renderableIndices;
  const count = renderables.count;

  for (let i = 0; i < count; i++) {
    const renderable = items[renderableIndices[i]]!;
    const s = renderable._storeIndex * MESH3D_STORE_STRIDE;
    const tx = storeF32[s + 12];
    const ty = storeF32[s + 13];
    const tz = storeF32[s + 14];

    const wx = bm[0] * tx + bm[4] * ty + bm[8] * tz + bm[12];
    const wy = bm[1] * tx + bm[5] * ty + bm[9] * tz + bm[13];
    const wz = bm[2] * tx + bm[6] * ty + bm[10] * tz + bm[14];

    const dx = wx - camX;
    const dy = wy - camY;
    const dz = wz - camZ;

    renderable._sortKey = -(dx * dx + dy * dy + dz * dz);
  }

  renderables.sortForced((m) => m._sortKey);
}
