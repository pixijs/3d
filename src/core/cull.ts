import { isMobile, isSafari } from 'pixi.js';

import type { CullMode } from '../scene/View3D';

/**
 * A batch's cull mode in one pass: `'gpu'` falls back to `'cpu'` where the pass can't compact on the GPU
 * @internal
 */
export function resolveCullProducer(mode: CullMode, gpuCompaction: boolean): CullMode {
  return mode === 'gpu' && !gpuCompaction ? 'cpu' : mode;
}

/**
 * Per pass, the largest batch in instances that culls on the CPU and draws direct, rather than on the GPU and
 * indirect; it works around WebKit's GPU cost per indirect draw, and an unset entry takes the browser's default
 * @internal
 */
export const cpuSubmission: {
  forward?: number;
  shadow?: number;
} = {};

const CPU_SUBMISSION_WEBKIT = { forward: 50_000, shadow: 20_000 } as const;

let _webKit: boolean | undefined;

/**
 * The pass's {@link cpuSubmission} cap: its override, or the browser's default, `0` outside WebKit
 * @internal
 */
export function cpuSubmissionLimit(pass: 'forward' | 'shadow'): number {
  const set = cpuSubmission[pass];
  if (set !== undefined) return set;
  _webKit ??= isMobile.apple.device || isSafari();
  return _webKit ? CPU_SUBMISSION_WEBKIT[pass] : 0;
}

const _batchPlanes = new Float32Array(24);

/**
 * The six world-space frustum planes in a batch's local frame, renormalized to compare with local sphere radii;
 * `planes` itself for an identity batch, or else a shared scratch that the next call overwrites
 * @internal
 */
export function transformFrustumToBatch(planes: Float32Array, f32: Float32Array): Float32Array {
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
