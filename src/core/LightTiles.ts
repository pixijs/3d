import type { Matrix4 } from '../math/matrix/Matrix4';
import type { TypedFixedArray } from '../math/utils/misc';
import { FLOATS_PER_LIGHT } from '../scene/View3D';
import type { RenderSession } from './render-passes/RenderSession';

/**
 * Number of columns in the screen tile grid
 * @internal
 */
export const LIGHT_TILES_X = 16;

/**
 * Number of rows in the screen tile grid
 * @internal
 */
export const LIGHT_TILES_Y = 9;

/**
 * Number of screen tiles, and the offset of the depth masks
 * @internal
 */
export const LIGHT_TILE_COUNT = LIGHT_TILES_X * LIGHT_TILES_Y;

/**
 * Camera-aligned depth intervals, stored after the screen-tile masks
 * @internal
 */
export const LIGHT_DEPTH_BINS = 32;

/**
 * Four masks per uniform vector
 * @internal
 */
export const LIGHT_TILE_LANES = Math.ceil((LIGHT_TILE_COUNT + LIGHT_DEPTH_BINS) / 4);

/**
 * Grid lines stored as world-space planes, `[nx, ny, nz, d]` per line with a unit normal
 *
 * Column lines precede row lines. Each `binLightTiles` call rebuilds the planes.
 */
const gridPlanes = new Float32Array((LIGHT_TILES_X + 1 + LIGHT_TILES_Y + 1) * 4);

/**
 * Writes the planes of one axis's grid lines
 *
 * The line at NDC `k` satisfies `clip.axis - k * clip.w = 0`. The view-projection matrix's rows
 * give the corresponding world-space plane. Its positive side contains visible points whose
 * NDC coordinate exceeds `k`.
 * @param e - The view-projection's elements.
 * @param axis - Row of the matrix the axis reads: 0 for x, 1 for y.
 * @param lines - How many lines the axis has, one more than its tiles.
 * @param offset - Where in `gridPlanes` the axis's planes start.
 */
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
 * Bins lights into screen tiles and camera-depth intervals; a fragment intersects both masks
 *
 * Tile planes come from the bound projection, including target flips and lens shifts. Depth
 * intervals cover the finite lights that reach the screen, not the camera's entire far range.
 * The two masks conservatively bound each light's range sphere; shading still tests the sphere
 * and spot cone. Keeping the axes separate avoids storing a full 3D grid.
 * @param out - Screen-tile masks followed by depth masks, padded to whole uniform vectors.
 * @param lightData - Packed lights with the LightDataList layout.
 * @param lightCount - Active packed entries, at most MAX_LIGHTS.
 * @param viewProjection - World-to-clip matrix bound for these draws.
 * @param view - World-to-camera matrix, whose negative Z axis defines depth.
 * @param depthPlane - Receives the world-position-to-depth-bin dot product coefficients.
 * @internal
 */
export function binLightTiles(
  out: Int32Array,
  lightData: Float32Array,
  lightCount: number,
  viewProjection: Matrix4,
  view: Matrix4,
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

  // Clip w as a plane: a sphere wholly on its negative side is behind the camera.
  const wLength = Math.sqrt(e[3] * e[3] + e[7] * e[7] + e[11] * e[11]);

  for (let i = 0; i < lightCount; i++) {
    const o = i * FLOATS_PER_LIGHT;
    const bit = 1 << i;
    const range = lightData[o + 7];

    // Directional (type 0), or a point or spot light with no range.
    if (lightData[o + 3] === 0 || range <= 0 || !Number.isFinite(range)) {
      everywhere |= bit;
      continue;
    }

    const px = lightData[o];
    const py = lightData[o + 1];
    const pz = lightData[o + 2];

    if (e[3] * px + e[7] * py + e[11] * pz + e[15] <= -range * wLength) continue;

    // A sphere wholly above a grid line excludes the tiles below it, and vice versa.
    // Test every line because the results need not be ordered when the sphere crosses the
    // camera plane. Each plane test still bounds the visible part of the sphere.
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
    for (let t = 0; t < LIGHT_TILE_COUNT; t++) out[t] |= everywhere;
  }
  out.fill(everywhere, LIGHT_TILE_COUNT);
  depthPlane.fill(0);
  if (finiteLights === 0) return;

  // Clamp outside depths to the edge bins: this adds false positives, never missing light.
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
    const radius = lightData[o + 7] * radiusScale;
    // Bound float32 dot-product rounding, including cancellation far from the world origin.
    const padding = (Math.abs(x) + Math.abs(y) + Math.abs(z) + Math.abs(depthPlane[3]) + radius) * 1e-6 + 1e-5;
    const first = Math.max(0, Math.min(LIGHT_DEPTH_BINS - 1, Math.floor(center - radius - padding)));
    const last = Math.max(0, Math.min(LIGHT_DEPTH_BINS - 1, Math.floor(center + radius + padding)));
    for (let bin = first; bin <= last; bin++) out[LIGHT_TILE_COUNT + bin] |= bit;
  }
}

/**
 * One camera's screen-tile and depth masks
 *
 * Each camera has its own masks because its view and projection change which tiles a light reaches.
 * The grid spans the camera's GPU viewport. The shader uses the camera group's `uViewport`
 * to find each fragment's tile.
 * @internal
 */
export class LightTiles {
  /**
   * Screen-tile masks followed by depth masks, stored in `uLightTiles`
   *
   * See `binLightTiles`.
   * All bits start set, which disables tile rejection until the first `prepare` call.
   */
  public readonly masks = new Int32Array(LIGHT_TILE_LANES * 4).fill(-1);
  /** Dot with a homogeneous world position, then clamp to the depth-bin range */
  public readonly depthPlane = new Float32Array(4);

  /** The last prepared session; a new session or invalidation triggers binning */
  private _session: RenderSession | null = null;

  /**
   * Bins the view's packed lights before any pass draws
   *
   * Passes reuse the masks within a session until the camera's matrices change and invalidate them.
   * `uploadCamera` prepares the masks after the view packs its lights.
   * @param session - The frame's render session.
   * @param viewProjection - World-to-clip, as bound for the draws that will read the masks.
   * @param view - World-to-camera matrix for depth binning.
   * @returns Whether the masks were binned and need uploading.
   */
  public prepare(session: RenderSession, viewProjection: Matrix4, view: Matrix4): boolean {
    if (this._session === session) return false;
    this._session = session;

    const lights = session.view3d._lightDataList;
    binLightTiles(this.masks, lights.data, lights.count, viewProjection, view, this.depthPlane);

    return true;
  }

  /** Invalidates the masks when the camera's matrices change and releases the previous session */
  public invalidate(): void {
    this._session = null;
  }

  /** Releases the stored session and its references to the view and renderer */
  public destroy(): void {
    this.invalidate();
  }
}
