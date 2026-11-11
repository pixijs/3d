import type { Matrix4 } from '../math/matrix/Matrix4';
import type { TypedFixedArray } from '../math/utils/misc';
import { FLOATS_PER_LIGHT } from '../scene/View3D';
import type { ReadonlyRect, RenderSession } from './render-passes/RenderSession';

/** @internal */
export const LIGHT_TILES_X = 16;

/** @internal */
export const LIGHT_TILES_Y = 9;

/**
 * `vec4<i32>` lanes of tile masks, four tiles to a lane; the lighting shader reads tile `t` at `[t >> 2][t & 3]`
 * @internal
 */
export const LIGHT_TILE_LANES = Math.ceil((LIGHT_TILES_X * LIGHT_TILES_Y) / 4);

/** @internal */
export const LIGHT_DEPTH_BINS = 32;

/** @internal */
export const LIGHT_DEPTH_LANES = Math.ceil(LIGHT_DEPTH_BINS / 4);

const gridPlanes = new Float32Array((LIGHT_TILES_X + 1 + LIGHT_TILES_Y + 1) * 4);

function writeGridPlanes(e: TypedFixedArray<16>, axis: number, lines: number, offset: number): void {
  for (let b = 0; b < lines; b++) {
    const k = (2 * b) / (lines - 1) - 1;
    const nx = e[axis] - k * e[3];
    const ny = e[axis + 4] - k * e[7];
    const nz = e[axis + 8] - k * e[11];
    const invLength = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    const o = offset + b * 4;

    gridPlanes[o] = nx * invLength;
    gridPlanes[o + 1] = ny * invLength;
    gridPlanes[o + 2] = nz * invLength;
    gridPlanes[o + 3] = (e[axis + 12] - k * e[15]) * invLength;
  }
}

/**
 * Bins lights into screen tiles and depth intervals; light `i` is bit `i`, so `MAX_LIGHTS` in `View3D.ts` stops at 32
 *
 * Tests every grid line, as a sphere crossing the camera plane breaks their order, and pads bins for float32 rounding.
 * @param out - Receives the tile masks, tile `(x, y)` at `y * LIGHT_TILES_X + x`.
 * @param lightData - The packed lights.
 * @param lightCount - How many lights are packed.
 * @param viewProjection - The view-projection the draws use, with the target's Y flip.
 * @param view - World to camera; depth runs along its -Z.
 * @param depthMasks - Receives one mask per depth interval.
 * @param depthPlane - Receives the coefficients that turn a world position into a depth bin.
 * @internal
 */
export function binLightTiles(
  out: Int32Array,
  lightData: Float32Array,
  lightCount: number,
  viewProjection: Matrix4,
  view: Matrix4,
  depthMasks: Int32Array,
  depthPlane: Float32Array,
): void {
  const e = viewProjection.elements;
  const rowPlanes = (LIGHT_TILES_X + 1) * 4;
  const v = view.elements;
  const depthRadiusScale = Math.hypot(v[2], v[6], v[10]);
  let everywhere = 0;
  let finiteLights = 0;
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  out.fill(0);

  writeGridPlanes(e, 0, LIGHT_TILES_X + 1, 0);
  writeGridPlanes(e, 1, LIGHT_TILES_Y + 1, rowPlanes);

  const wLength = Math.sqrt(e[3] * e[3] + e[7] * e[7] + e[11] * e[11]);

  for (let i = 0; i < lightCount; i++) {
    const o = i * FLOATS_PER_LIGHT;
    const bit = 1 << i;
    const range = Math.sqrt(lightData[o + 7]);

    if (lightData[o + 3] === 0 || range <= 0 || !Number.isFinite(range)) {
      everywhere |= bit;
      continue;
    }

    const px = lightData[o];
    const py = lightData[o + 1];
    const pz = lightData[o + 2];

    if (e[3] * px + e[7] * py + e[11] * pz + e[15] <= -range * wLength) continue;

    let x0 = 0;
    let x1 = LIGHT_TILES_X - 1;
    for (let b = 0; b <= LIGHT_TILES_X; b++) {
      const p = b * 4;
      const distance = gridPlanes[p] * px + gridPlanes[p + 1] * py + gridPlanes[p + 2] * pz + gridPlanes[p + 3];
      if (distance >= range) x0 = Math.max(x0, b);
      else if (distance <= -range) x1 = Math.min(x1, b - 1);
    }
    if (x0 > x1) continue;

    let y0 = 0;
    let y1 = LIGHT_TILES_Y - 1;
    for (let b = 0; b <= LIGHT_TILES_Y; b++) {
      const p = rowPlanes + b * 4;
      const distance = gridPlanes[p] * px + gridPlanes[p + 1] * py + gridPlanes[p + 2] * pz + gridPlanes[p + 3];
      if (distance >= range) y0 = Math.max(y0, b);
      else if (distance <= -range) y1 = Math.min(y1, b - 1);
    }
    if (y0 > y1) continue;

    finiteLights |= bit;
    const depth = -(v[2] * px + v[6] * py + v[10] * pz + v[14]);
    const radius = range * depthRadiusScale;
    minDepth = Math.min(minDepth, depth - radius);
    maxDepth = Math.max(maxDepth, depth + radius);

    for (let ty = y0; ty <= y1; ty++) {
      const row = ty * LIGHT_TILES_X;
      for (let tx = x0; tx <= x1; tx++) out[row + tx] |= bit;
    }
  }

  if (everywhere !== 0) {
    const tileCount = LIGHT_TILES_X * LIGHT_TILES_Y;
    for (let t = 0; t < tileCount; t++) out[t] |= everywhere;
  }
  depthMasks.fill(everywhere);
  depthPlane.fill(0);
  if (finiteLights === 0) return;

  if (wLength > 0) minDepth = Math.max(minDepth, 0);

  const scale = LIGHT_DEPTH_BINS / Math.max(maxDepth - minDepth, 1e-6);
  depthPlane[0] = -v[2] * scale;
  depthPlane[1] = -v[6] * scale;
  depthPlane[2] = -v[10] * scale;
  depthPlane[3] = (-v[14] - minDepth) * scale;
  const radiusScale = Math.hypot(depthPlane[0], depthPlane[1], depthPlane[2]);

  for (let i = 0; i < lightCount; i++) {
    const bit = 1 << i;
    if ((finiteLights & bit) === 0) continue;
    const o = i * FLOATS_PER_LIGHT;
    const x = lightData[o] * depthPlane[0];
    const y = lightData[o + 1] * depthPlane[1];
    const z = lightData[o + 2] * depthPlane[2];
    const center = x + y + z + depthPlane[3];
    const radius = Math.sqrt(lightData[o + 7]) * radiusScale;
    const padding = (Math.abs(x) + Math.abs(y) + Math.abs(z) + Math.abs(depthPlane[3]) + radius) * 1e-6 + 1e-5;
    const first = Math.max(0, Math.min(LIGHT_DEPTH_BINS - 1, Math.floor(center - radius - padding)));
    const last = Math.max(0, Math.min(LIGHT_DEPTH_BINS - 1, Math.floor(center + radius + padding)));
    for (let bin = first; bin <= last; bin++) depthMasks[bin] |= bit;
  }
}

/** @internal */
export class LightTiles {
  /** Both mask arrays start with every bit set, so nothing is rejected before the first `prepare` */
  public readonly masks = new Int32Array(LIGHT_TILE_LANES * 4).fill(-1);
  public readonly depthMasks = new Int32Array(LIGHT_DEPTH_LANES * 4).fill(-1);
  public readonly depthPlane = new Float32Array(4);
  public readonly tileTransform = new Float32Array(4);

  private _session: RenderSession | null = null;

  public prepare(session: RenderSession, viewProjection: Matrix4, view: Matrix4): boolean {
    if (this._session === session) return false;
    this._session = session;

    const lights = session.view3d._lightDataList;
    binLightTiles(this.masks, lights.data, lights.count, viewProjection, view, this.depthMasks, this.depthPlane);

    return true;
  }

  public setViewport(rect: ReadonlyRect, topDown: boolean): boolean {
    const t = this.tileTransform;
    const scaleX = Math.fround(LIGHT_TILES_X / rect.width);
    const scaleY = Math.fround((topDown ? -LIGHT_TILES_Y : LIGHT_TILES_Y) / rect.height);
    const offsetX = Math.fround(-rect.x * scaleX);
    const offsetY = Math.fround((topDown ? LIGHT_TILES_Y : 0) - rect.y * scaleY);

    if (t[0] === scaleX && t[1] === scaleY && t[2] === offsetX && t[3] === offsetY) return false;
    t[0] = scaleX;
    t[1] = scaleY;
    t[2] = offsetX;
    t[3] = offsetY;

    return true;
  }

  public invalidate(): void {
    this._session = null;
  }

  /** Drops the session, which holds the view and the renderer */
  public destroy(): void {
    this.invalidate();
  }
}
