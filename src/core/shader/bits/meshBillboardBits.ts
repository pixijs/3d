import type { BillboardMode } from '../../../scene/Mesh3D';
import type { ShaderBit } from '../ShaderBit';

/**
 * Turns the mesh's normal into the billboard's basis, for lit materials only
 *
 * An unlit shader never reads `vNormal`, but both templates publish it anyway, so the compiler
 * can't be trusted to drop the work.
 *
 * Turning the normal, rather than replacing it with the direction to the camera, keeps authored
 * normals useful. A flat quad's `+Z` normal comes out facing the camera on its own, and the bent,
 * dome-shaped normals of foliage cards survive, where camera-facing normals would light them flat.
 * The basis is orthonormal, so a unit normal stays unit.
 */
const NORMAL_GPU = /*wgsl*/ `
  worldNormal = bbRight * normal.x + bbUp * normal.y + bbNormal * normal.z;
`;

const NORMAL_GL = /*glsl*/ `
  worldNormal = bbRight * normal.x + bbUp * normal.y + bbNormal * normal.z;
`;

/**
 * The `'spherical'` basis: the camera's own right and up, so the mesh faces the lens square-on
 * however the camera moves
 *
 * Rows 0 and 1 of the view matrix are the camera's right and up in world space, since an
 * orthonormal matrix's transpose is its inverse. Both languages index `m[column][row]`, so row 0 is
 * `m[0][0]`, `m[1][0]`, `m[2][0]`. `sphericalGl` is the GLSL twin.
 * @param lit - Also rotates the authored normal into the billboard basis, for lit materials
 */
function sphericalGpu(lit: boolean): string {
  return /*wgsl*/ `
  let bbRight = vec3<f32>(camera.uViewMatrix[0][0], camera.uViewMatrix[1][0], camera.uViewMatrix[2][0]);
  let bbUp    = vec3<f32>(camera.uViewMatrix[0][1], camera.uViewMatrix[1][1], camera.uViewMatrix[2][1]);
  let bbNormal = cross(bbRight, bbUp);

  let bbScaleX = length(modelMatrix[0].xyz);
  let bbScaleY = length(modelMatrix[1].xyz);
  let bbScaleZ = length(modelMatrix[2].xyz);

  worldPosition = vec4<f32>(
    modelMatrix[3].xyz
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  clipPosition = camera.uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GPU : ''}`;
}

function sphericalGl(lit: boolean): string {
  return /*glsl*/ `
  vec3 bbRight = vec3(uViewMatrix[0][0], uViewMatrix[1][0], uViewMatrix[2][0]);
  vec3 bbUp    = vec3(uViewMatrix[0][1], uViewMatrix[1][1], uViewMatrix[2][1]);
  vec3 bbNormal = cross(bbRight, bbUp);

  float bbScaleX = length(modelMatrix[0].xyz);
  float bbScaleY = length(modelMatrix[1].xyz);
  float bbScaleZ = length(modelMatrix[2].xyz);

  worldPosition = vec4(
    modelMatrix[3].xyz
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  gl_Position = uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GL : ''}`;
}

/**
 * The `'cylindrical'` basis: the mesh turns toward the camera around the node's own up column but
 * never tips, so a card keeps its footing however far the camera looks down
 *
 * The spin axis is the node's up column, so a tilted node spins around its tilted axis. A
 * zero-height mesh, such as a sprite whose texture hasn't loaded, has no axis; world up stands in,
 * and every corner offset is zero anyway.
 *
 * The right vector is the spin axis crossed with the direction to the camera flattened against the
 * axis. That cross product of a unit vector and a perpendicular one is already as long as the
 * flattened direction, so one `inverseSqrt` normalizes it. With the camera on the axis there is
 * nothing to face, and the mesh is edge-on whatever the choice, so the node's X column stands in,
 * or world X if that column has no length. `cylindricalGl` is the GLSL twin.
 * @param lit - Also rotates the authored normal into the billboard basis, for lit materials
 */
function cylindricalGpu(lit: boolean): string {
  return /*wgsl*/ `
  let bbColX = modelMatrix[0].xyz;
  let bbColY = modelMatrix[1].xyz;
  let bbScaleX = length(bbColX);
  let bbScaleY = length(bbColY);
  let bbScaleZ = length(modelMatrix[2].xyz);
  let bbCentre = modelMatrix[3].xyz;

  var bbUp = vec3<f32>(0.0, 1.0, 0.0);
  if (bbScaleY > 1e-8) { bbUp = bbColY / bbScaleY; }

  let bbToCam = camera.uCameraPosition - bbCentre;
  let bbFlat = bbToCam - bbUp * dot(bbToCam, bbUp);
  let bbFlatLenSq = dot(bbFlat, bbFlat);

  var bbRight = vec3<f32>(1.0, 0.0, 0.0);
  if (bbFlatLenSq > 1e-8) {
    bbRight = cross(bbUp, bbFlat) * inverseSqrt(bbFlatLenSq);
  } else if (bbScaleX > 1e-8) {
    bbRight = bbColX / bbScaleX;
  }

  let bbNormal = cross(bbRight, bbUp);

  worldPosition = vec4<f32>(
    bbCentre
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  clipPosition = camera.uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GPU : ''}`;
}

function cylindricalGl(lit: boolean): string {
  return /*glsl*/ `
  vec3 bbColX = modelMatrix[0].xyz;
  vec3 bbColY = modelMatrix[1].xyz;
  float bbScaleX = length(bbColX);
  float bbScaleY = length(bbColY);
  float bbScaleZ = length(modelMatrix[2].xyz);
  vec3 bbCentre = modelMatrix[3].xyz;

  vec3 bbUp = vec3(0.0, 1.0, 0.0);
  if (bbScaleY > 1e-8) { bbUp = bbColY / bbScaleY; }

  vec3 bbToCam = uCameraPosition - bbCentre;
  vec3 bbFlat = bbToCam - bbUp * dot(bbToCam, bbUp);
  float bbFlatLenSq = dot(bbFlat, bbFlat);

  vec3 bbRight = vec3(1.0, 0.0, 0.0);
  if (bbFlatLenSq > 1e-8) {
    bbRight = cross(bbUp, bbFlat) * inversesqrt(bbFlatLenSq);
  } else if (bbScaleX > 1e-8) {
    bbRight = bbColX / bbScaleX;
  }

  vec3 bbNormal = cross(bbRight, bbUp);

  worldPosition = vec4(
    bbCentre
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  gl_Position = uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GL : ''}`;
}

/** One bit per mode and lit flag, built on first use */
const cache: Partial<Record<string, ShaderBit>> = Object.create(null);

/**
 * The vertex transform behind {@link Mesh3D#billboardMode}
 *
 * In the vertex `afterTransform` slot, it rebuilds the mesh around its world-space origin,
 * `modelMatrix[3].xyz`, in an orthonormal basis aimed at the camera. Local X maps to `bbRight`, Y
 * to `bbUp` and Z to `bbNormal`, each scaled by the length of the matching model-matrix column, so
 * the node's scale, its parents' and any size baked into its local matrix all apply.
 *
 * All three axes are rebuilt, so it works on any geometry. `bbNormal` points back toward the
 * camera, so local `+Z` faces the viewer: a flat card turns square-on, and a solid mesh turns with
 * its depth intact.
 *
 * Frustum culling stays exact when the geometry's bounding sphere is centred on its origin, as a
 * sprite's quad is. Both culls then centre the sphere on `modelMatrix[3]` and take its radius from
 * the longest column. A vertex at local `(x, y, z)` lands `hypot(x·sx, y·sy, z·sz)` from there, at
 * most `max(sx, sy, sz)·hypot(x, y, z)`, which is inside that radius whichever way the camera
 * faces.
 *
 * It reassigns `worldPosition`, not just `clipPosition`, so the `vPosition` varying follows the
 * billboarded vertex. The fog bits compute `vFogDepth` from `worldPosition` in this same
 * `afterTransform` slot, as the material's own bits may, so the renderer adds this bit ahead of
 * both.
 *
 * An orthonormal basis can't hold the shear that a non-uniform parent scale under a rotation makes,
 * so each axis keeps its scale and the shear is lost.
 * @param mode - Which billboard basis to build. `'none'` is handled by the
 * caller (nothing is injected) and throws here.
 * @param lit - Whether the material reads normals. When false the normal
 * rotation is omitted entirely, so unlit materials compile exactly what they
 * would with no lighting support at all.
 * @see {@link Sprite3D} For the scene node that sets the mode.
 * @see {@link getParticleBit} For the streaming-particle variant, which
 * billboards per-vertex around a world-space `aPosition` instead.
 * @category rendering
 * @advanced
 */
export function getMeshBillboardBit(mode: BillboardMode, lit: boolean): ShaderBit {
  const key = `${mode}:${lit}`;
  const existing = cache[key];
  if (existing) return existing;

  if (mode === 'none') {
    throw new Error("[meshBillboardBits] billboardMode 'none' has no bit — the caller must skip injection.");
  }

  const spherical = mode === 'spherical';
  const bit: ShaderBit = {
    name: `meshBillboard${spherical ? 'Spherical' : 'Cylindrical'}${lit ? 'Lit' : ''}`,
    gpu: { vertex: { afterTransform: spherical ? sphericalGpu(lit) : cylindricalGpu(lit) } },
    gl: { vertex: { afterTransform: spherical ? sphericalGl(lit) : cylindricalGl(lit) } },
  };

  cache[key] = bit;
  return bit;
}
