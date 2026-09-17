import type { BillboardMode } from '../../../scene/Mesh3D';
import type { ShaderBit } from '../ShaderBit';

/**
 * Rotates the interpolated normal into the billboard's basis. Only emitted for
 * lit materials — an unlit shader never reads `vNormal`, and both templates
 * publish it unconditionally, so the work would not reliably be stripped.
 *
 * Rotating rather than overwriting with the camera vector is what keeps
 * authored normals usable: a flat `+Z` quad normal comes out camera-facing on
 * its own, while bent (hemispherical) foliage normals — the standard treatment
 * for tree cards, and the reason camera-facing normals look flat and dead —
 * survive the transform. `bbRight` / `bbUp` / `bbNormal` are orthonormal, so a
 * unit normal stays unit.
 */
const NORMAL_GPU = /*wgsl*/ `
  worldNormal = bbRight * normal.x + bbUp * normal.y + bbNormal * normal.z;
`;

const NORMAL_GL = /*glsl*/ `
  worldNormal = bbRight * normal.x + bbUp * normal.y + bbNormal * normal.z;
`;

/**
 * Screen-aligned: the quad's basis is the camera's own right/up, so it faces the
 * lens square-on however the camera moves.
 * @param lit - Also rotates the authored normal into the billboard basis, for lit materials
 */
function sphericalGpu(lit: boolean): string {
  return /*wgsl*/ `
  // Rows 0/1 of the view matrix are the world-space camera right/up (an
  // orthonormal view matrix's transpose is its inverse). WGSL indexes
  // m[col][row], so row 0 is m[0][0], m[1][0], m[2][0].
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
 * Axis-locked: the quad yaws toward the camera around the node's own up column
 * but never pitches, so the card keeps its footing however far you tilt the
 * camera down.
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

  // Spin axis = the node's up column, so a tilted node billboards around its
  // tilted axis. A zero-height quad (unloaded 0x0 texture) has no axis to spin
  // around; world up stands in and the corner offsets are zero anyway.
  var bbUp = vec3<f32>(0.0, 1.0, 0.0);
  if (bbScaleY > 1e-8) { bbUp = bbColY / bbScaleY; }

  // Direction to the camera, flattened against the spin axis.
  let bbToCam = camera.uCameraPosition - bbCentre;
  let bbFlat = bbToCam - bbUp * dot(bbToCam, bbUp);
  let bbFlatLenSq = dot(bbFlat, bbFlat);

  // Camera sitting on the spin axis leaves nothing to face: the quad is edge-on
  // from there whatever we pick, so fall back to the node's own X column.
  var bbRight = vec3<f32>(1.0, 0.0, 0.0);
  if (bbFlatLenSq > 1e-8) {
    // cross(unit, perpendicular) already has length |bbFlat|.
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

/** One entry per (mode, lit) pair; each variant is built once and reused */
const cache: Partial<Record<string, ShaderBit>> = Object.create(null);

/**
 * Billboard vertex transform — the shader half of {@link Mesh3D#billboardMode}
 *
 * Runs in the vertex `afterTransform` slot and rebuilds the mesh around
 * `modelMatrix[3].xyz`, its world-space origin, in an orthonormal basis aimed at
 * the camera: local X maps to `bbRight`, Y to `bbUp`, Z to `bbNormal`, each
 * scaled by the length of the matching model-matrix column. Composed world scale —
 * the node's own, every parent's, and any size folded into the local matrix —
 * applies with no uniform of its own.
 *
 * All three axes are rebuilt, so this works on any geometry. A flat card comes
 * out facing the camera; a solid mesh keeps its depth and turns to face the
 * camera, since `bbNormal` points back down the view direction and local `+Z` is
 * therefore the face that ends up toward the viewer.
 *
 * Rebuilding around `modelMatrix[3]` keeps frustum culling exact. Both culls put
 * the bounding-sphere centre there and take its radius from the longest column;
 * a vertex at local `(x, y, z)` lands `hypot(x·sx, y·sy, z·sz)` from that centre,
 * at most `max(sx, sy, sz)·hypot(x, y, z)` — inside the radius the geometry's own
 * bounding sphere already implies, whichever way the camera faces.
 *
 * It reassigns `worldPosition` rather than only `clipPosition`, so the
 * `vPosition` varying follows the billboarded vertex. Distance fog reads that
 * varying and stays correct because the core injects this bit before the fog bit.
 *
 * Shear from non-uniform parent scale under rotation can't be represented by an
 * orthonormal basis: axis scales are honoured, shear is dropped.
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
    // Names are the shader cache's identity, so the variant has to be in here.
    name: `meshBillboard${spherical ? 'Spherical' : 'Cylindrical'}${lit ? 'Lit' : ''}`,
    gpu: { vertex: { afterTransform: spherical ? sphericalGpu(lit) : cylindricalGpu(lit) } },
    gl: { vertex: { afterTransform: spherical ? sphericalGl(lit) : cylindricalGl(lit) } },
  };

  cache[key] = bit;
  return bit;
}
