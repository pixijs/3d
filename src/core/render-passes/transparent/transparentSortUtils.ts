import type { Matrix4 } from '../../../math/matrix/Matrix4';
import type { Vector3 } from '../../../math/vector/Vector3';
import type { Mesh3DData } from '../../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../../batcher/SortedMesh3DView';
import { MESH3D_STORE_STRIDE } from '../../buffers/Mesh3DDataStoreBuffer';

/**
 * Sorts back to front: keys are negated squared distances, so the ascending sort puts the farthest first
 *
 * Positions are store-row lanes 12 to 14: world space in the scene batch, batch-local in a {@link BatchedMesh3D}'s.
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
    const renderable = items[renderableIndices[i]];

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
 * Sorts back to front, keyed as {@link calculateTransparentDistances}
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
    const renderable = items[renderableIndices[i]] as Mesh3DData & { worldTransform: Matrix4 };
    const e = renderable.worldTransform.elements;

    const dx = e[12] - camX;
    const dy = e[13] - camY;
    const dz = e[14] - camZ;

    renderable._sortKey = -(dx * dx + dy * dy + dz * dz);
  }

  renderables.sortForced((m) => m._sortKey);
}

/**
 * Sorts back to front, keyed as {@link calculateTransparentDistances}
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
    const renderable = items[renderableIndices[i]];
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
