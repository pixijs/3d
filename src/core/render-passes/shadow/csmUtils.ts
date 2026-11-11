import { Matrix4 } from '../../../math/matrix/Matrix4';
import { Box } from '../../../math/shapes/Box';
import type { Camera3D } from '../../../scene/cameras/Camera3D';

/**
 * Most cascades a directional light can have, which `LightShadow.cascades` in `Light.ts` states
 * @internal
 */
export const MAX_CASCADES = 4;

/**
 * Fraction of each cascade's depth range spent fading into the next; both shadow bits read it
 * @internal
 */
export const CASCADE_BLEND_FRACTION = 0.1;

const _invViewProj = new Matrix4();
const _lightSpaceFromClip = new Matrix4();

/**
 * `getFrustumSliceBoundsInLightSpace`'s min and max depth and centroid x and y; a typed array, so
 * a write doesn't box a fresh heap number
 */
const _sliceBounds = new Float64Array(4);

/**
 * Cascade split depths, by the practical split scheme of GPU Gems 3, chapter 10
 * @param near - Camera near plane distance
 * @param far - Max shadow distance
 * @param count - Number of cascades, 1 to 4
 * @param lambda - Blend factor: 0 uniform, 1 logarithmic
 * @param out - Filled in place; the last split is `far`
 * @internal
 */
export function computeCascadeSplits(
  near: number,
  far: number,
  count: number,
  lambda: number,
  out: number[],
): number[] {
  out.length = count;

  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const log = near * Math.pow(far / near, t);
    const uniform = near + (far - near) * t;
    out[i - 1] = lambda * log + (1 - lambda) * uniform;
  }

  return out;
}

/**
 * Stages the clip-to-light-space transform {@link computeCascadeMatrix} reads; call it once per light first
 * @internal
 */
export function prepareLightSpaceTransform(camera: Camera3D, inverseLightMatrix: Matrix4): void {
  _invViewProj.getInverse(camera.viewProjection);
  _lightSpaceFromClip.multiplyMatrices(inverseLightMatrix, _invViewProj);
}

function getFrustumSliceBoundsInLightSpace(nearZ: number, farZ: number): void {
  const e = _lightSpaceFromClip.elements;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumX = 0;
  let sumY = 0;

  for (let k = 0; k < 2; k++) {
    const nz = k === 0 ? nearZ : farZ;

    for (let iy = -1; iy <= 1; iy += 2) {
      for (let ix = -1; ix <= 1; ix += 2) {
        const x = e[0] * ix + e[4] * iy + e[8] * nz + e[12];
        const y = e[1] * ix + e[5] * iy + e[9] * nz + e[13];
        const z = e[2] * ix + e[6] * iy + e[10] * nz + e[14];
        const w = e[3] * ix + e[7] * iy + e[11] * nz + e[15];
        const lz = z / w;

        sumX += x / w;
        sumY += y / w;
        if (lz < minZ) minZ = lz;
        if (lz > maxZ) maxZ = lz;
      }
    }
  }

  _sliceBounds[0] = minZ;
  _sliceBounds[1] = maxZ;
  _sliceBounds[2] = sumX * 0.125;
  _sliceBounds[3] = sumY * 0.125;
}

function distanceToNdcZ(camera: Camera3D, distance: number): number {
  const proj = camera.projection.elements;
  const clipZ = proj[10] * -distance + proj[14];
  const clipW = proj[11] * -distance + proj[15];

  return clipZ / clipW;
}

function applyOrthoZRange01(projection: Matrix4, near: number, far: number): void {
  const te = projection.elements;
  const zScale = 1 / (near - far);
  te[10] = zScale;
  te[14] = near * zScale;
}

/**
 * Snaps a window centre down to whole shadow-map texels so shadow edges don't swim; both arguments
 * are light-space world units, never the projection's normalised translation
 */
function snapCentreToTexel(centre: number, halfExtent: number, mapSize: number): number {
  const texelWorld = (2 * halfExtent) / mapSize;
  return Math.floor(centre / texelWorld) * texelWorld;
}

/**
 * The ortho projection of one cascade: a square around the slice's bounding sphere, which keeps its
 * size from frame to frame while texel snapping keeps its position, so edges don't shimmer
 * @param camera - Scene camera
 * @param splitNear - Near split distance from the camera
 * @param splitFar - Far split distance from the camera, within its far plane, as
 *   `ShadowRenderPassBase.updateLightShadowData` clamps it
 * @param outProjection - Receives the projection
 * @param mapSize - Shadow map size in texels
 * @param applyWebGPUZRangeFix - Map depth to 0 to 1 for WebGPU; `false` keeps WebGL's -1 to 1
 * @internal
 */
export function computeCascadeMatrix(
  camera: Camera3D,
  splitNear: number,
  splitFar: number,
  outProjection: Matrix4,
  mapSize: number,
  applyWebGPUZRangeFix = true,
): void {
  const nearZ = distanceToNdcZ(camera, splitNear);
  const farZ = distanceToNdcZ(camera, splitFar);

  getFrustumSliceBoundsInLightSpace(nearZ, farZ);

  const pe = camera.projection.elements;
  const spread = camera.mode === 'orthographic' ? 1 : splitFar;
  const halfFarH = spread / pe[5];
  const halfFarW = spread / pe[0];
  const halfDepth = (splitFar - splitNear) * 0.5;
  const r = Math.sqrt(halfFarW * halfFarW + halfFarH * halfFarH + halfDepth * halfDepth);

  const near = -_sliceBounds[1] - r * DEPTH_EXTENSION;
  const far = -_sliceBounds[0];

  const centreX = snapCentreToTexel(_sliceBounds[2], r, mapSize);
  const centreY = snapCentreToTexel(_sliceBounds[3], r, mapSize);

  outProjection.makeOrthographic(centreX - r, centreX + r, centreY + r, centreY - r, near, far);

  if (applyWebGPUZRangeFix) applyOrthoZRange01(outProjection, near, far);
}

const _lightSpaceBox = new Box();

/** Footprint margin, as a fraction of the fitted box, so an edge caster's shadow still lands inside */
const FIXED_BOX_PAD = 0.05;

/**
 * How far a shadow frustum reaches toward the light, in multiples of its half-width, so the depth
 * range scales with the scene; the `bias` option is a fraction of that range
 */
const DEPTH_EXTENSION = 4;

/**
 * The ortho projection of a directional light's fixed shadow box, padded and texel-snapped
 * @internal
 */
export function computeFixedBoxMatrix(
  boundsWorld: Box,
  inverseLightMatrix: Matrix4,
  outProjection: Matrix4,
  mapSize: number,
  applyWebGPUZRangeFix = true,
): void {
  boundsWorld.applyMatrix4(inverseLightMatrix, _lightSpaceBox);

  const { min, max } = _lightSpaceBox;
  const halfX = (max.x - min.x) * 0.5 * (1 + 2 * FIXED_BOX_PAD);
  const halfY = (max.y - min.y) * 0.5 * (1 + 2 * FIXED_BOX_PAD);

  const centreX = snapCentreToTexel((min.x + max.x) * 0.5, halfX, mapSize);
  const centreY = snapCentreToTexel((min.y + max.y) * 0.5, halfY, mapSize);

  const near = -max.z - Math.max(halfX, halfY) * DEPTH_EXTENSION;
  const far = -min.z;

  outProjection.makeOrthographic(centreX - halfX, centreX + halfX, centreY + halfY, centreY - halfY, near, far);

  if (applyWebGPUZRangeFix) applyOrthoZRange01(outProjection, near, far);
}
