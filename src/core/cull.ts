import type { CullMode } from '../scene/View3D';

/**
 * Concrete producer a batch resolves to for a frame — what the render side routes on
 *
 * `'off'` binds the raw instance buffer and draws every instance; `'cpu'` and
 * `'gpu'` bind the compacted buffer (survivors only), produced on the CPU or in a
 * compute pass respectively.
 * @internal
 */
type CullProducer = 'off' | 'cpu' | 'gpu';

// `'auto'` off/cull gate (instance count): at or below, drawing all beats a cull dispatch; above, cull.
// Count-only for now — geometry complexity could sharpen it (#242).
const AUTO_OFF_MAX = 300;

/**
 * Resolves a view's {@link CullMode} to the concrete `CullProducer` for one batch
 *
 * Decided per batch from the backend and the batch's instance count. `'gpu'`
 * needs a compute pass, so it degrades to `'cpu'` on WebGL.
 * @param mode - The view's configured cull mode.
 * @param isWebGPU - Whether the active backend is WebGPU.
 * @param instanceCount - The batch's instance count (drives the `'auto'` gate).
 * @returns The producer the batch uses this frame.
 * @internal
 */
export function resolveCullProducer(mode: CullMode, isWebGPU: boolean, instanceCount: number): CullProducer {
  switch (mode) {
    case 'off':
      return 'off';
    case 'cpu':
      return 'cpu';
    case 'gpu':
      return isWebGPU ? 'gpu' : 'cpu';
    default: // 'auto'
      if (instanceCount <= AUTO_OFF_MAX) return 'off';
      if (!isWebGPU) return 'cpu';
      return 'gpu';
  }
}

// Module scratch: a batch's frustum planes transformed into batch-local space (`Bᵀ · plane`). The
// CPU cull and the GPU dispatch each consume it fully before the next call, so one buffer is safe.
const _batchPlanes = new Float32Array(24);

/**
 * Transforms the six world-space frustum `planes` into a batch's local frame
 *
 * Applies `Bᵀ` (the transpose of the batch world matrix `B` = store row 0), renormalized so signed
 * distances stay comparable to a batch-local sphere's radius. Returns `planes` unchanged when `B` is
 * identity (scene batches). The result aliases a shared scratch — copy it (e.g. into a uniform)
 * before the next call.
 *
 * Both cull producers use this so they test in the same frame as the cached bounding spheres: the
 * CPU cull (`produceCpuCompaction`) and the GPU compaction, which uploads the result per batch and
 * so drops the per-instance `B × L` combine from its kernel. WebGL culls in the same frame too, in
 * the batcher's replay.
 * @param planes - The six world-space frustum planes, 4 floats each.
 * @param f32 - The batch's store f32 view; row 0 holds the batch world matrix.
 * @returns The batch-local planes — `planes` itself, or the shared scratch.
 * @internal
 */
export function transformFrustumToBatch(planes: Float32Array, f32: Float32Array): Float32Array {
  // Batch world matrix (store row 0), column-major.
  const b00 = f32[0];
  const b01 = f32[1];
  const b02 = f32[2];
  const b10 = f32[4];
  const b11 = f32[5];
  const b12 = f32[6];
  const b20 = f32[8];
  const b21 = f32[9];
  const b22 = f32[10];
  const btx = f32[12];
  const bty = f32[13];
  const btz = f32[14];
  if (
    b00 === 1 &&
    b11 === 1 &&
    b22 === 1 &&
    b01 === 0 &&
    b02 === 0 &&
    b10 === 0 &&
    b12 === 0 &&
    b20 === 0 &&
    b21 === 0 &&
    btx === 0 &&
    bty === 0 &&
    btz === 0
  ) {
    return planes;
  }

  // `Bᵀ · plane`, renormalized. `Bᵀ`'s rows are B's columns, so the transformed normal is
  // (col0·n, col1·n, col2·n) and the offset is (translation·n + d).
  for (let p = 0; p < 6; p++) {
    const o = p * 4;
    const nx = planes[o];
    const ny = planes[o + 1];
    const nz = planes[o + 2];
    const tx = b00 * nx + b01 * ny + b02 * nz;
    const ty = b10 * nx + b11 * ny + b12 * nz;
    const tz = b20 * nx + b21 * ny + b22 * nz;
    const inv = 1 / Math.sqrt(tx * tx + ty * ty + tz * tz);
    _batchPlanes[o] = tx * inv;
    _batchPlanes[o + 1] = ty * inv;
    _batchPlanes[o + 2] = tz * inv;
    _batchPlanes[o + 3] = (btx * nx + bty * ny + btz * nz + planes[o + 3]) * inv;
  }
  return _batchPlanes;
}
