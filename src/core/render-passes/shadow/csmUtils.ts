import { Matrix4 } from '../../../math/matrix/Matrix4';
import { Box } from '../../../math/shapes/Box';
import type { Camera3D } from '../../../scene/cameras/Camera3D';

/**
 * Maximum number of cascades supported per directional light
 * @internal
 */
export const MAX_CASCADES = 4;

/**
 * Fraction of each cascade's depth range spent fading into the next one
 *
 * Cascades differ in resolution, so switching between them mid-surface draws a visible line
 * across the ground. Both shadow bits fade over the tail of each cascade instead, and read this
 * constant so the two backends can't drift apart.
 *
 * The next cascade has valid depth here because its fitted volume is the bounding sphere of its
 * frustum slice, which overhangs its own near split by far more than this band — comfortably so
 * at ordinary fields of view, and still with room to spare at 15 degrees.
 * @internal
 */
export const CASCADE_BLEND_FRACTION = 0.1;

const _invViewProj = new Matrix4();
const _lightSpaceFromClip = new Matrix4();

// Per-cascade frustum slice results, written by getFrustumSliceBoundsInLightSpace
// and read by computeCascadeMatrix.
let _boundsMinZ = 0;
let _boundsMaxZ = 0;
let _centroidX = 0;
let _centroidY = 0;

/**
 * Computes cascade split depths using a blend of uniform and logarithmic distributions
 *
 * The "practical split scheme" from GPU Gems 3, Ch. 10.
 * @param near - Camera near plane distance (positive).
 * @param far - Camera far plane distance (positive), or the max shadow distance.
 * @param count - Number of cascades (1–4).
 * @param lambda - Blend factor: 0 = uniform, 1 = logarithmic.
 * @param out - Destination array, resized to `count` and filled in place.
 * @returns `out` — `count` split depths, each in (near, far]; the last is `far`.
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
 * Precomputes the clip-to-light-space matrix used by all cascades of a single light
 *
 * Call once before the per-cascade loop — the result is cached in module-level
 * `_lightSpaceFromClip` and reused by `getFrustumSliceBoundsInLightSpace`.
 * @param camera - Scene camera with a valid viewProjection.
 * @param inverseLightMatrix - Light-space view matrix (inverse of light world).
 * @internal
 */
export function prepareLightSpaceTransform(camera: Camera3D, inverseLightMatrix: Matrix4): void {
  _invViewProj.getInverse(camera.viewProjection);
  _lightSpaceFromClip.multiplyMatrices(inverseLightMatrix, _invViewProj);
}

/**
 * Fits an orthographic shadow frustum to a sub-range of the camera's view frustum in light space
 *
 * Same frustum-corner fitting as the standard shadow pass, but parameterised by NDC Z range
 * rather than world-unit distance. Requires `prepareLightSpaceTransform` to have been called
 * first for the current camera + light combination.
 * @param nearZ - NDC near Z for the cascade slice (0-based for WebGPU).
 * @param farZ - NDC far Z for the cascade slice.
 */
function getFrustumSliceBoundsInLightSpace(nearZ: number, farZ: number): void {
  const e = _lightSpaceFromClip.elements;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumX = 0;
  let sumY = 0;

  for (const nz of [nearZ, farZ]) {
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

  _boundsMinZ = minZ;
  _boundsMaxZ = maxZ;
  _centroidX = sumX * 0.125;
  _centroidY = sumY * 0.125;
}

/**
 * Converts a world-space distance from the camera into NDC Z using the camera's projection matrix
 *
 * Both rows come straight out of the projection, so this holds for either camera mode:
 *
 * ```text
 * clip_z = proj[10] * (-dist) + proj[14]
 * clip_w = proj[11] * (-dist) + proj[15]
 * ndc_z  = clip_z / clip_w
 * ```
 *
 * `clip_w` is what separates them — `proj[11]` is `-1` under perspective, making the divisor the
 * distance itself, and `0` under orthographic, making it a constant `1`.
 *
 * Callers clamp `distance` to the camera's far plane, so the result never exceeds 1.
 * @param camera - Scene camera whose projection maps the distance.
 * @param distance - World-space distance from the camera.
 * @returns The NDC Z for `distance`.
 * @internal
 */
function distanceToNdcZ(camera: Camera3D, distance: number): number {
  const proj = camera.projection.elements;
  const clipZ = proj[10] * -distance + proj[14];
  const clipW = proj[11] * -distance + proj[15];

  return clipZ / clipW;
}

/**
 * Remaps an orthographic projection's depth from WebGL's [-1,1] clip range to WebGPU's [0,1]
 *
 * `makeOrthographic` emits the [-1,1] form; WebGPU wants the near plane at 0. Rewrites the two
 * Z elements in place.
 * @param projection - The orthographic projection to rewrite.
 * @param near - Near plane distance.
 * @param far - Far plane distance.
 */
function applyOrthoZRange01(projection: Matrix4, near: number, far: number): void {
  const te = projection.elements;
  const zScale = 1 / (near - far);
  te[10] = zScale;
  te[14] = near * zScale;
}

/**
 * Quantises an ortho shadow window's centre to whole shadow-map texels ("Stable Fit")
 *
 * Sub-texel motion is what makes shadow edges swim: shift the window a third of a texel and
 * every depth sample lands on different texels, so the edge crawls even though nothing in the
 * scene moved. Snapping the centre to the texel grid means the window only ever steps by whole
 * texels, and the samples stay put.
 *
 * Both arguments are light-space world distances, which is the only pairing that makes the
 * division meaningful. Applying this to the finished projection instead would divide its
 * translation — a normalised `-centre / halfExtent`, not a world distance — by a world texel
 * size, stepping the window by a fraction of the whole frustum at a time.
 * @param centre - Window centre on one light-space axis, in world units.
 * @param halfExtent - Half the window's world size on that axis.
 * @param mapSize - Shadow map width/height in texels.
 * @returns `centre` moved back to the nearest texel boundary at or below it.
 */
function snapCentreToTexel(centre: number, halfExtent: number, mapSize: number): number {
  const texelWorld = (2 * halfExtent) / mapSize;
  return Math.floor(centre / texelWorld) * texelWorld;
}

/**
 * Computes the orthographic projection for one cascade of a directional light
 *
 * The cascade's view is the light-space transform `prepareLightSpaceTransform` staged before this
 * call; the caller pairs the two into a camera and forms the view-projection there.
 * @param camera - Scene camera with valid projection and viewProjection.
 * @param splitNear - Near split distance in world units from camera.
 * @param splitFar - Far split distance in world units from camera.
 * @param outProjection - Receives the ortho projection matrix.
 * @param mapSize - Shadow map resolution for texel snapping.
 * @param applyWebGPUZRangeFix - Remap depth to [0,1] for WebGPU; `false` keeps the
 *   [-1,1] range WebGL expects.
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

  // Fixed radius from camera geometry — depends only on the projection and the
  // split distances, NOT on camera orientation. This keeps the ortho scale
  // constant across frames, eliminating shadow-edge shimmering.
  //
  // A perspective slice widens with distance, so its far face is `splitFar` times the
  // projection's half-angle; an orthographic one is the same width all the way along, so
  // its half-extents are just the projection's, whatever the split.
  const pe = camera.projection.elements;
  const spread = camera.mode === 'orthographic' ? 1 : splitFar;
  const halfFarH = spread / pe[5];
  const halfFarW = spread / pe[0];
  const halfDepth = (splitFar - splitNear) * 0.5;
  const r = Math.sqrt(halfFarW * halfFarW + halfFarH * halfFarH + halfDepth * halfDepth);

  // Z (depth) is extended backwards towards the light so that shadow
  // casters outside the camera frustum are still captured — without this,
  // geometry behind/above the view gets clipped and shadows disappear.
  const near = -_boundsMaxZ - r * DEPTH_EXTENSION;
  const far = -_boundsMinZ;

  const centreX = snapCentreToTexel(_centroidX, r, mapSize);
  const centreY = snapCentreToTexel(_centroidY, r, mapSize);

  outProjection.makeOrthographic(centreX - r, centreX + r, centreY + r, centreY - r, near, far);

  if (applyWebGPUZRangeFix) applyOrthoZRange01(outProjection, near, far);
}

// Scratch for computeFixedBoxMatrix — the world bounds resolved into light space.
const _lightSpaceBox = new Box();

/** Footprint margin (fraction of the fitted box) so an edge caster's shadow still lands inside */
const FIXED_BOX_PAD = 0.05;

/**
 * How far a shadow frustum reaches toward the light, as a multiple of its own half-width
 *
 * Casters between the light and the shadowed region have to rasterise or their shadows go
 * missing, and nothing bounds how high above that region a caster can sit. Sizing the reach to
 * the frustum keeps it meaningful whatever units a scene is modelled in — a fixed world
 * distance is either far too little or thousands of times too much as soon as the scene is not
 * roughly metre-scaled.
 *
 * It also keeps the depth range proportional to the scene, which matters because the shadow
 * `bias` option is a fraction of that range — a range far larger than the scene turns the bias
 * into more than the scene itself and erases every shadow.
 */
const DEPTH_EXTENSION = 4;

/**
 * Computes the orthographic projection for a directional light's fixed shadow box
 *
 * The placement used when the light isn't cascaded. `boundsWorld` is the world region to shadow
 * (the scene's caster bounds when auto-fit, or a user-supplied box); this encloses it in a
 * light-aligned ortho frustum.
 *
 * The near plane is pushed toward the light so casters between the light and the box still
 * rasterise, and the XY footprint is padded by `FIXED_BOX_PAD` to catch shadows that fall just
 * outside the caster bounds. Texel-snapped so edges don't swim as the box re-fits frame to frame.
 *
 * The box's view is `inverseLightMatrix`; the caller pairs the two into a camera and forms the
 * view-projection there.
 * @param boundsWorld - World region to shadow.
 * @param inverseLightMatrix - Light-space view matrix (inverse of light world).
 * @param outProjection - Receives the ortho projection matrix.
 * @param mapSize - Shadow map resolution for texel snapping.
 * @param applyWebGPUZRangeFix - Remap depth to [0,1] for WebGPU; `false` keeps the
 *   [-1,1] range WebGL expects.
 * @internal
 */
export function computeFixedBoxMatrix(
  boundsWorld: Box,
  inverseLightMatrix: Matrix4,
  outProjection: Matrix4,
  mapSize: number,
  applyWebGPUZRangeFix = true,
): void {
  // World AABB → light space (applyMatrix4 rebuilds the AABB around the light's axes).
  boundsWorld.applyMatrix4(inverseLightMatrix, _lightSpaceBox);

  const { min, max } = _lightSpaceBox;
  const halfX = (max.x - min.x) * 0.5 * (1 + 2 * FIXED_BOX_PAD);
  const halfY = (max.y - min.y) * 0.5 * (1 + 2 * FIXED_BOX_PAD);

  const centreX = snapCentreToTexel((min.x + max.x) * 0.5, halfX, mapSize);
  const centreY = snapCentreToTexel((min.y + max.y) * 0.5, halfY, mapSize);

  // Light faces -Z; negate to depth-from-light. Near is extended back toward the light so
  // overhead casters aren't clipped at the near plane.
  const near = -max.z - Math.max(halfX, halfY) * DEPTH_EXTENSION;
  const far = -min.z;

  outProjection.makeOrthographic(centreX - halfX, centreX + halfX, centreY + halfY, centreY - halfY, near, far);

  if (applyWebGPUZRangeFix) applyOrthoZRange01(outProjection, near, far);
}
