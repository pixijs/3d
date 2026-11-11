import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * How each particle's quad faces the camera
 *
 * - `'spherical'`: faces the camera fully, the classic billboard
 * - `'cylindrical'`: turns about world Y only, so the quad stays upright; suits fire, smoke
 *   columns and grass cards
 * - `'horizontal'`: doesn't face the camera; the quad lies flat on the world's XZ (ground) plane.
 *   Suits impact rings, blob shadows and scorch marks
 *
 * Not the same as `BillboardMode`, which turns a whole `Mesh3D` about its origin.
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
 * One generator for both languages, so the maths can't drift; the `max` keeps a camera rolled onto
 * its side, whose right axis has no XZ part, from dividing by zero
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

function billboardBasisWgsl(mode: ParticleBillboardMode): string {
  return billboardBasis(mode, true);
}

function billboardBasisGlsl(mode: ParticleBillboardMode): string {
  return billboardBasis(mode, false);
}

/**
 * Which {@link getParticleBit} variant to build
 * @category scene
 * @advanced
 */
export interface ParticleBitOptions {
  /** How each quad faces the camera */
  billboard: ParticleBillboardMode;
  /** Whether each particle carries an `aParticleUVFrame` flipbook window, 8 bytes a vertex */
  frames: boolean;
  /** Whether particle positions are relative to the mesh rather than in world space */
  localSpace: boolean;
}

const cache: Record<string, ShaderBit> = Object.create(null);

/**
 * The shader bit that turns each particle's four vertices into a camera-facing quad
 *
 * The geometry repeats each particle's centre in `aPosition` (`float32x3`) on all four vertices,
 * and gives each vertex its corner, `(0, 0)` to `(1, 1)`, in `aUV` (`unorm8x2`). The bit declares
 * `aParticleSizeRot` (`float32x2`), `aParticleColor` (`unorm8x4`) and, with `frames`,
 * `aParticleUVFrame` (`unorm16x4`); {@link ParticleBuiltInValues} says what each holds.
 *
 * A bit composed after it can grow, spin or recolour a particle by assigning the vertex-stage
 * locals `particleSize`, `particleRotation` and `particleColor` in its `beforeTransform`.
 * `particleColor` is in display space, so a colour ramp blends as a 2D tween does.
 * @param options - Which variant to build
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

        end: 'output.vParticleColor = vec4<f32>(decodeColor(particleColor.rgb), particleColor.a);',
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

        end: 'vParticleColor = vec4(decodeColor(particleColor.rgb), particleColor.a);',
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
