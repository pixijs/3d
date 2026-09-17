import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * How a particle quad is oriented before its corners are expanded
 *
 * - `'spherical'` — faces the camera on every axis (the classic billboard)
 * - `'cylindrical'` — spins around world Y only, so the quad stays upright.
 *   Right for smoke columns, fire, grass cards and anything that shouldn't tilt
 *   when the camera looks down
 * - `'horizontal'` — no camera facing at all: the quad lies flat in the world
 *   XZ (ground) plane. Right for impact rings, blob shadows and scorch marks
 *
 * Distinct from `BillboardMode`, which turns a whole `Mesh3D` to face the camera
 * about its own origin. A particle system billboards each of its thousands of
 * quads about that quad's own centre, so it needs its own basis — and its third
 * mode is a real orientation rather than "off".
 * @category scene
 * @standard
 */
export type ParticleBillboardMode = 'spherical' | 'cylindrical' | 'horizontal';

/**
 * Shader source declaring `billboardRight` / `billboardUp`, the world-space
 * basis a quad's corners expand along
 *
 * The snippet declares locals only; the caller decides what to do with them.
 *
 * The two backends differ by a handful of tokens — the view matrix is
 * `camera.uViewMatrix` in WGSL and a bare `uViewMatrix` in GLSL, and vector
 * constructors are spelled differently — so one generator emits both rather
 * than letting the maths drift between two copies.
 *
 * The view matrix is orthonormal, so its transpose is its inverse: column-major
 * `m[col][row]` reads row 0 as world-space camera right and row 1 as camera up.
 * Both languages agree on `m[col][row]`.
 * @param mode - Orientation the basis builds
 * @param gpu - `true` for WGSL, `false` for GLSL
 * @returns The basis snippet in the requested shading language
 */
function billboardBasis(mode: ParticleBillboardMode, gpu: boolean): string {
  const vec3 = gpu ? 'vec3<f32>' : 'vec3';
  const view = gpu ? 'camera.uViewMatrix' : 'uViewMatrix';
  const decl = gpu ? 'let' : 'vec3';
  const right = `${view}[0][0], ${view}[1][0], ${view}[2][0]`;

  if (mode === 'horizontal') {
    return `
  ${decl} billboardRight = ${vec3}(1.0, 0.0, 0.0);
  ${decl} billboardUp    = ${vec3}(0.0, 0.0, 1.0);
`;
  }

  if (mode === 'cylindrical') {
    // Camera right flattened onto the ground plane keeps the quad upright.
    // The max() covers the degenerate case of a rolled camera looking straight
    // down, where the flattened vector collapses to zero.
    const flat = gpu ? `${vec3}(camRight.x, 0.0, camRight.z)` : 'vec3(camRight.x, 0.0, camRight.z)';
    const flatLen = gpu ? 'length(vec2<f32>(camRight.x, camRight.z))' : 'length(camRight.xz)';

    return `
  ${decl} camRight = ${vec3}(${right});
  ${decl} billboardRight = ${flat} / max(${flatLen}, 1e-5);
  ${decl} billboardUp = ${vec3}(0.0, 1.0, 0.0);
`;
  }

  return `
  ${decl} billboardRight = ${vec3}(${right});
  ${decl} billboardUp    = ${vec3}(${view}[0][1], ${view}[1][1], ${view}[2][1]);
`;
}

/**
 * WGSL that declares the `billboardRight` / `billboardUp` world-space basis
 * @param mode - Orientation the basis builds
 * @internal
 */
function billboardBasisWgsl(mode: ParticleBillboardMode): string {
  return billboardBasis(mode, true);
}

/**
 * GLSL counterpart of {@link billboardBasisWgsl} — same locals, same maths
 * @param mode - Orientation the basis builds
 * @internal
 */
function billboardBasisGlsl(mode: ParticleBillboardMode): string {
  return billboardBasis(mode, false);
}

/**
 * Selects a {@link getParticleBit} variant
 *
 * Every flag drops code when off.
 * @category scene
 * @advanced
 */
export interface ParticleBitOptions {
  /** How the quad is oriented before its corners expand */
  billboard: ParticleBillboardMode;
  /**
   * Whether the geometry carries the per-particle `aParticleUVFrame` window
   *
   * Off for single-frame systems, whose UVs go through the material's own
   * `uvTransform` instead — 8 fewer bytes on every streamed vertex.
   */
  frames: boolean;
  /**
   * Whether particle centres are emitter-local (`true`) or already world-space
   * (`false`)
   *
   * Local centres go through the mesh's `modelMatrix`, so the whole system
   * moves, rotates and scales with its parent for free.
   */
  localSpace: boolean;
}

const cache: Record<string, ShaderBit> = Object.create(null);

/**
 * The particle bit: expands one streamed particle record into a camera-facing
 * quad, entirely in the vertex shader
 *
 * ## Geometry contract
 *
 * - `aPosition` (`float32x3`, decoded by `positionBit`) — the particle centre,
 *   replicated across the quad's four corners.
 * - `aUV` (`unorm8x2`, decoded by `uvsBit`) — the corner id, `(0,0)`…`(1,1)`.
 *   Read here as a `[-0.5, 0.5]` corner offset and, in the same pass, left in
 *   place as the sprite's texture coordinate.
 *
 * `ParticleContainer3D` derives its vertex buffer from the attributes its bits
 * declare, so the three below existing in the buffer at all is a consequence of
 * this declaration, not a second list kept in step with it.
 *
 * - `aParticleSizeRot` (`float32x2`) — world-space diameter and rotation in
 *   radians, about the view axis.
 * - `aParticleColor` (`unorm8x4`) — linear RGB tint plus opacity.
 * - `aParticleUVFrame` (`unorm16x4`, `frames` variant only) — the flipbook
 *   window `(u0, v0, uScale, vScale)` this particle samples.
 *
 * ## Locals other bits may write
 *
 * `beforeTransform` declares `particleSize`, `particleRotation` and
 * `particleColor` as mutable locals seeded from the attributes above, and the
 * quad expansion in `afterTransform` reads those rather than the attributes. A
 * bit composed after this one can therefore fade, grow or recolour a particle
 * by assigning to them, with no knowledge of how the quad is built.
 *
 * Size is a world-space diameter, so particles shrink with distance exactly as
 * the rest of the scene does.
 *
 * ## Transform
 *
 * The quad is built in the `afterTransform` slot, which reassigns
 * `worldPosition` and `clipPosition` after the template's standard transform.
 * That's what lets world-space particles ignore `modelMatrix` entirely without
 * anyone faking an identity transform — the mesh's store row keeps its real
 * position, which the WebGPU transparent sort reads.
 * @param options - Which variant to build; every combination is cached
 * @returns The bit for that variant, the same object on every call
 * @category scene
 * @advanced
 */
export function getParticleBit(options: ParticleBitOptions): ShaderBit {
  const { billboard, frames, localSpace } = options;
  const key = `particle:${billboard}:${localSpace ? 'local' : 'world'}${frames ? ':frames' : ''}`;

  const existing = cache[key];
  if (existing) return existing;

  // World-space centres skip modelMatrix; local ones ride the one the template
  // already applied. The billboard offset is world-space either way, so it is
  // added after the centre lands in world space.
  const centreGpu = localSpace ? 'worldPosition.xyz' : 'position.xyz';
  const centreGl = centreGpu;

  const bit: ShaderBit = {
    name: key,

    attributes: {
      aParticleSizeRot: 'float32x2',
      aParticleColor: 'unorm8x4',
      ...(frames ? ({ aParticleUVFrame: 'unorm16x4' } as const) : null),
    },

    interStage: {
      vParticleColor: 'vec4<f32>',
    },

    gpu: {
      vertex: {
        beforeTransform: /*wgsl*/ `
  // uv arrives as the corner id. Keep the signed corner for the quad expansion,
  // with v = 0 on the top edge so the sprite reads the way its image does; the
  // id itself doubles as the sprite's texture coordinate, remapped into this
  // particle's flipbook window when the system has more than one frame.
  let particleCorner = vec2<f32>(uv.x - 0.5, 0.5 - uv.y);
${frames ? '  uv = input.aParticleUVFrame.xy + uv * input.aParticleUVFrame.zw;\n' : ''}
  // The values the expansion reads. Declared here as vars so a bit composed
  // after this one can scale or replace them before the quad is built.
  var particleSize = input.aParticleSizeRot.x;
  var particleRotation = input.aParticleSizeRot.y;
  var particleColor = input.aParticleColor;
`,

        afterTransform: /*wgsl*/ `${billboardBasisWgsl(billboard)}
  let particleCos = cos(particleRotation);
  let particleSin = sin(particleRotation);
  let particleSpun = vec2<f32>(
    particleCorner.x * particleCos - particleCorner.y * particleSin,
    particleCorner.x * particleSin + particleCorner.y * particleCos
  ) * particleSize;

  worldPosition = vec4<f32>(
    ${centreGpu} + billboardRight * particleSpun.x + billboardUp * particleSpun.y,
    1.0
  );
  clipPosition = camera.uViewProjectionMatrix * worldPosition;
`,

        end: 'output.vParticleColor = particleColor;',
      },
      fragment: {
        material: /*wgsl*/ `
  albedo *= input.vParticleColor.rgb;
  alpha *= input.vParticleColor.a;
`,
      },
    },

    gl: {
      vertex: {
        beforeTransform: /*glsl*/ `
  vec2 particleCorner = vec2(uv.x - 0.5, 0.5 - uv.y);
${frames ? '  uv = aParticleUVFrame.xy + uv * aParticleUVFrame.zw;\n' : ''}
  // The values the expansion reads. A bit composed after this one can scale
  // or replace them before the quad is built.
  float particleSize = aParticleSizeRot.x;
  float particleRotation = aParticleSizeRot.y;
  vec4 particleColor = aParticleColor;
`,

        afterTransform: /*glsl*/ `${billboardBasisGlsl(billboard)}
  float particleCos = cos(particleRotation);
  float particleSin = sin(particleRotation);
  vec2 particleSpun = vec2(
    particleCorner.x * particleCos - particleCorner.y * particleSin,
    particleCorner.x * particleSin + particleCorner.y * particleCos
  ) * particleSize;

  worldPosition = vec4(
    ${centreGl} + billboardRight * particleSpun.x + billboardUp * particleSpun.y,
    1.0
  );
  gl_Position = uProjectionMatrix * uViewMatrix * worldPosition;
`,

        end: 'vParticleColor = particleColor;',
      },
      fragment: {
        material: /*glsl*/ `
  albedo *= vParticleColor.rgb;
  alpha *= vParticleColor.a;
`,
      },
    },
  };

  cache[key] = bit;
  return bit;
}
