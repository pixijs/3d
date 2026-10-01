import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * How each particle's quad faces the camera
 *
 * - `'spherical'`: faces the camera fully, the classic billboard
 * - `'cylindrical'`: turns about world Y only, so the quad stays upright. Right for smoke
 *   columns, fire, grass cards and anything that shouldn't tilt when the camera looks down
 * - `'horizontal'`: doesn't face the camera at all; the quad lies flat on the world's XZ
 *   (ground) plane. Right for impact rings, blob shadows and scorch marks
 *
 * Not the same as `BillboardMode`, which turns a whole `Mesh3D` about its origin. A particle
 * system turns each quad about its own centre, and its third mode is an orientation rather than
 * "off".
 * @example
 * ```ts
 * const fire = new ParticleSystem3D({ billboard: 'cylindrical' });
 * const ripples = new ParticleSystem3D({ billboard: 'horizontal' });
 * ```
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
 * The two backends differ by a handful of tokens: the view matrix is
 * `camera.uViewMatrix` in WGSL and a bare `uViewMatrix` in GLSL, and vector
 * constructors are spelled differently. So one generator emits both rather
 * than letting the maths drift between two copies.
 *
 * The view matrix is orthonormal, so its transpose is its inverse: column-major
 * `m[col][row]` reads row 0 as world-space camera right and row 1 as camera up.
 * Both languages agree on `m[col][row]`.
 *
 * `'cylindrical'` flattens camera right onto the ground plane, which keeps the quad upright. A
 * rolled camera looking straight down flattens it to zero, so the length is floored before the
 * divide.
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
 * GLSL counterpart of {@link billboardBasisWgsl}: same locals, same maths
 * @param mode - Orientation the basis builds
 * @internal
 */
function billboardBasisGlsl(mode: ParticleBillboardMode): string {
  return billboardBasis(mode, false);
}

/**
 * Picks a {@link getParticleBit} variant; every flag that is off leaves its code out
 * @category scene
 * @advanced
 */
export interface ParticleBitOptions {
  /** How each quad faces the camera */
  billboard: ParticleBillboardMode;
  /**
   * Whether the geometry carries the per-particle `aParticleUVFrame` window
   *
   * Off for single-frame systems, whose UVs go through the material's own
   * `uvTransform` instead, saving 8 bytes on every vertex.
   */
  frames: boolean;
  /**
   * Whether particle positions are relative to the mesh (`true`) or already in world space
   * (`false`)
   *
   * Local positions go through the mesh's `modelMatrix`, so the whole system moves, rotates and
   * scales with its parent at no extra cost.
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
 * - `aPosition` (`float32x3`, decoded by `positionBit`): the particle centre,
 *   repeated in the quad's four corners.
 * - `aUV` (`unorm8x2`, decoded by `uvsBit`): the corner id, `(0,0)` to `(1,1)`.
 *   Read here as a `[-0.5, 0.5]` corner offset, with `v = 0` on the top edge so
 *   the sprite reads the way its image does. The id itself stays as the sprite's
 *   texture coordinate, remapped into the particle's flipbook window in the
 *   `frames` variant.
 *
 * The bit declares the three attributes below, and `ParticleContainer3D` builds
 * its vertex buffer from what its bits declare, so there is no second list to
 * keep in step.
 *
 * - `aParticleSizeRot` (`float32x2`): world-space diameter, and rotation in
 *   radians about the view axis.
 * - `aParticleColor` (`unorm8x4`): linear RGB tint plus opacity.
 * - `aParticleUVFrame` (`unorm16x4`, `frames` variant only): the flipbook
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
 * World-space particles take their centre from `position`, skipping
 * `modelMatrix`; local ones take `worldPosition`, which the template already
 * moved through it. So world-space particles ignore `modelMatrix` without
 * faking an identity transform, and the mesh's store row keeps its real
 * position, which the WebGPU transparent sort reads. The corner offset is
 * world-space either way, so it is added once the centre is in world space.
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
  let particleCorner = vec2<f32>(uv.x - 0.5, 0.5 - uv.y);
${frames ? '  uv = input.aParticleUVFrame.xy + uv * input.aParticleUVFrame.zw;\n' : ''}
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
