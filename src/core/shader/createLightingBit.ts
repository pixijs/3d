import { MAX_LIGHTS } from '../../scene/View3D';
import { LIGHT_DEPTH_BINS, LIGHT_TILES_X, LIGHT_TILES_Y } from '../LightTiles';
import type { ShaderBit } from './ShaderBit';

/** Unpacks a light in `LightDataList`'s layout; the include guard lets two lighting bits share a shader */
const GL_GET_LIGHT_HELPER = /*glsl*/ `
#ifndef PIXIJS_3D_GET_LIGHT_DEFINED
#define PIXIJS_3D_GET_LIGHT_DEFINED
Light getLight(int index) {
  int offset = index * 4;
  vec4 d0 = uLightData[offset + 0];
  vec4 d1 = uLightData[offset + 1];
  vec4 d2 = uLightData[offset + 2];
  vec4 d3 = uLightData[offset + 3];

  Light l;
  l.position = d0.xyz;
  l.type = d0.w;
  l.color = d1.xyz;
  l.rangeSq = d1.w;
  l.direction = d2.xyz;
  l.coneCos = d2.w;
  l.innerConeCos = d3.x;
  l.shadowDataIndex = d3.y;
  l.radiusPow4 = d3.w;
  return l;
}
#endif
`;

/**
 * Options for {@link createLightingBit}: the shading math of a lighting model, such as toon or
 * Blinn-Phong, around a light loop the factory writes
 *
 * The generated fragment `lighting` slot runs:
 *
 * ```text
 * preLighting
 * for (each light that can reach this fragment) {
 *   work out light, lightDir, attenuation, nDotL and shadow, or skip the light
 *   perLight
 * }
 * postLighting
 * ```
 *
 * 1. In `preLighting`, declare and zero your accumulators, such as `directLight`, and work out
 *    anything that doesn't depend on the light, such as `nDotV`.
 * 2. In `perLight`, add this light's share to them. `continue;` skips the rest of this light.
 *    Lights that don't reach the fragment or that the surface faces away from never get here.
 * 3. In `postLighting`, write `finalColor` from the accumulators and whatever the material bit
 *    declared, such as `emissive`. Exposure, fog and tone mapping run after it.
 *
 * The loop sits in a block of its own, so names these snippets declare aren't visible to later
 * slots such as `end`.
 *
 * ## What `perLight` can read
 *
 * | Name          | Type    | Value                                                         |
 * |---------------|---------|---------------------------------------------------------------|
 * | `light`       | `Light` | this light                                                    |
 * | `lightDir`    | `vec3`  | normalized, from the fragment toward the light                |
 * | `attenuation` | `f32`   | distance falloff times the spot cone, above 0                 |
 * | `nDotL`       | `f32`   | `max(dot(normal, lightDir), 0)`, above 0                      |
 * | `shadow`      | `f32`   | 1 lit, 0 shadowed                                             |
 * | `normal`      | `vec3`  | the world-space surface normal, as the material bits left it  |
 * | `viewDir`     | `vec3`  | normalized, toward the camera; declared by the material bit   |
 *
 * Anything else the model needs, such as `albedo` and `roughness`, comes from the material bit
 * that runs before it. The light's kind is `light.kind` in WGSL and `light.type` in GLSL; compare
 * it with `LIGHT_DIRECTIONAL`, `LIGHT_POINT` or `LIGHT_SPOT`.
 *
 * ## Lobes
 *
 * Another bit in the descriptor can add per-light math to this loop, rather than run a second loop
 * that samples every shadow again, through the fragment slots `lobePreLighting`, `lobePerLight`
 * and `lobePostLighting`. Each runs after the matching snippet here, in the order the lobe bits are
 * listed, so `lobePostLighting` sees the assembled `finalColor` and can rewrite it.
 *
 * ## Requirements
 *
 * Use the bit in a material with {@link BaseMaterial3D#lit} on, the default. A pass's own shader
 * can't run it.
 * @category rendering
 * @advanced
 */
export interface CreateLightingBitOptions {
  /** The bit's {@link ShaderBit#name}, which must be unique */
  name: string;

  /** Bindings the model needs, such as its own `material` fields */
  bindings?: ShaderBit['bindings'];
  /** Structs the model declares */
  structs?: ShaderBit['structs'];
  /** Textures the model samples, such as a lookup table */
  textures?: string[];

  /** Bits the model needs in the shader, such as {@link mathConstantsBit} for `PI` and `INV_PI` */
  requires?: ShaderBit[];

  /** Code for the `{{header}}` slot, such as helper functions and constants */
  header?: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };

  /**
   * Code that runs once, before the light loop
   *
   * Declare the accumulators here, and anything that doesn't depend on the light. What it declares
   * stays in scope for `perLight` and `postLighting`.
   */
  preLighting?: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };

  /** The shading math for one light, run inside the loop; {@link CreateLightingBitOptions} lists what it reads */
  perLight: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };

  /**
   * Code that runs once, after the light loop
   *
   * It writes the template's `finalColor`, as in
   * `finalColor = ambient * occlusion + directLight + emissive;`.
   */
  postLighting?: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };
}

/**
 * Builds a lighting `ShaderBit` around the shading math in `opts`
 *
 * Call it once at module scope and list the bit in a material's `bitsGpu` and `bitsGl`.
 * {@link CreateLightingBitOptions} says what each snippet can read.
 * @example A diffuse-only Lambert model
 *
 * ```ts
 * export const lambertLightingBit = createLightingBit({
 *   name: 'lambertLighting',
 *
 *   preLighting: {
 *     gpu: 'var directLight = vec3<f32>(0.0);',
 *     gl:  'vec3 directLight = vec3(0.0);',
 *   },
 *
 *   perLight: {
 *     gpu: 'directLight += albedo * light.color * nDotL * attenuation * shadow;',
 *     gl:  'directLight += albedo * light.color * nDotL * attenuation * shadow;',
 *   },
 *
 *   postLighting: {
 *     gpu: 'finalColor = directLight;',
 *     gl:  'finalColor = directLight;',
 *   },
 * });
 * ```
 *
 * The PBR material's Cook-Torrance lighting and the toon material's `toonLightingBit` are built the
 * same way.
 * @param opts - The lighting model's snippets and metadata
 * @returns The composed lighting bit
 * @category rendering
 * @advanced
 */
export function createLightingBit(opts: CreateLightingBitOptions): ShaderBit {
  const wgslLoop = /*wgsl*/ `
{
${opts.preLighting?.gpu ?? ''}
{{fragmentLobePreLighting}}

  let lightTile = clamp(
    vec2<i32>(input.position.xy * camera.uLightTileTransform.xy + camera.uLightTileTransform.zw),
    vec2<i32>(0),
    vec2<i32>(${LIGHT_TILES_X - 1}, ${LIGHT_TILES_Y - 1})
  );
  let lightTileIndex = lightTile.y * ${LIGHT_TILES_X} + lightTile.x;
  let lightDepthIndex = i32(clamp(
    dot(camera.uLightDepthPlane, vec4<f32>(input.vPosition, 1.0)), 0.0, ${LIGHT_DEPTH_BINS - 1}.0
  ));
  var lightMask = u32(camera.uLightTiles[lightTileIndex >> 2][lightTileIndex & 3]) &
    u32(camera.uLightDepthMasks[lightDepthIndex >> 2][lightDepthIndex & 3]);

  for (var n: i32 = 0; n < ${MAX_LIGHTS}; n++) {
    if (lightMask == 0u) { break; }
    let i = i32(firstTrailingBit(lightMask));
    lightMask &= lightMask - 1u;

    let lightOffset = i * 4;
    let light0 = global.uLightData[lightOffset];
    let light1 = global.uLightData[lightOffset + 1];
    let light2 = global.uLightData[lightOffset + 2];
    let light3 = global.uLightData[lightOffset + 3];
    let light = Light(light0.xyz, light0.w, light1.xyz, light1.w, light2.xyz, light2.w, light3.x, light3.y, light3.z, light3.w);

    var lightDir: vec3<f32>;
    var attenuation: f32 = 1.0;

    if (light.kind == LIGHT_DIRECTIONAL) {
      lightDir = -light.direction;
    } else {
      let toLight = light.position - input.vPosition;
      let distanceSq = dot(toLight, toLight);

      if (light.rangeSq > 0.0) {
        if (distanceSq >= light.rangeSq) { continue; }

        let distRatio = distanceSq / light.rangeSq;
        let windowFalloff = saturate(1.0 - distRatio * distRatio);
        attenuation = windowFalloff * windowFalloff * inverseSqrt(distanceSq * distanceSq + light.radiusPow4);
      } else {
        attenuation = inverseSqrt(distanceSq * distanceSq + light.radiusPow4);
      }

      lightDir = toLight * inverseSqrt(distanceSq);

      if (light.kind == LIGHT_SPOT) {
        let spotCos = dot(-lightDir, light.direction);
        let spotAtten = saturate((spotCos - light.coneCos) / max(light.innerConeCos - light.coneCos, 1e-6));
        attenuation *= spotAtten * spotAtten;
      }
    }

    if (attenuation <= 0.0) { continue; }

    let nDotL = max(dot(normal, lightDir), 0.0);
    if (nDotL <= 0.0) { continue; }

    let shadow = calculateShadow(light.shadowDataIndex, light.cascadeCount, input.vPosition, normal, nDotL);

${opts.perLight.gpu ?? ''}
{{fragmentLobePerLight}}
  }

${opts.postLighting?.gpu ?? ''}
{{fragmentLobePostLighting}}
}
`;

  /**
   * Keeps a fixed `MAX_LIGHTS` trip count, since some GL compilers make an unbounded loop far slower,
   * and reads the light index off the lowest bit's float exponent, as GLSL ES 3.00 has no `findLSB`
   */
  const glslLoop = /*glsl*/ `
{
${opts.preLighting?.gl ?? ''}
{{lobePreLighting}}

  ivec2 lightTile = clamp(
    ivec2(gl_FragCoord.xy * uLightTileTransform.xy + uLightTileTransform.zw),
    ivec2(0),
    ivec2(${LIGHT_TILES_X - 1}, ${LIGHT_TILES_Y - 1})
  );
  int lightTileIndex = lightTile.y * ${LIGHT_TILES_X} + lightTile.x;
  int lightDepthIndex = int(clamp(
    dot(uLightDepthPlane, vec4(vPosition, 1.0)), 0.0, ${LIGHT_DEPTH_BINS - 1}.0
  ));
  uint lightMask = uint(uLightTiles[lightTileIndex >> 2][lightTileIndex & 3]) &
    uint(uLightDepthMasks[lightDepthIndex >> 2][lightDepthIndex & 3]);

  for (int n = 0; n < ${MAX_LIGHTS}; n++) {
    if (lightMask == 0u) break;
    uint lowestBit = lightMask & (0u - lightMask);
    int i = int(floatBitsToUint(float(lowestBit)) >> 23u) - 127;
    lightMask &= lightMask - 1u;

    Light light = getLight(i);

    vec3 lightDir;
    float attenuation = 1.0;

    if (light.type == LIGHT_DIRECTIONAL) {
      lightDir = -light.direction;
    } else {
      vec3 toLight = light.position - vPosition;
      float distanceSq = dot(toLight, toLight);

      if (light.rangeSq > 0.0) {
        if (distanceSq >= light.rangeSq) continue;

        float distRatio = distanceSq / light.rangeSq;
        float windowFalloff = clamp(1.0 - distRatio * distRatio, 0.0, 1.0);
        attenuation = windowFalloff * windowFalloff * inversesqrt(distanceSq * distanceSq + light.radiusPow4);
      } else {
        attenuation = inversesqrt(distanceSq * distanceSq + light.radiusPow4);
      }

      lightDir = toLight * inversesqrt(distanceSq);

      if (light.type == LIGHT_SPOT) {
        float spotCos = dot(-lightDir, light.direction);
        float spotAtten = clamp((spotCos - light.coneCos) / max(light.innerConeCos - light.coneCos, 1e-6), 0.0, 1.0);
        attenuation *= spotAtten * spotAtten;
      }
    }

    if (attenuation <= 0.0) continue;

    float nDotL = max(dot(normal, lightDir), 0.0);
    if (nDotL <= 0.0) continue;

    float shadow = calculateShadow(light, vPosition, normal, nDotL);

${opts.perLight.gl ?? ''}
{{lobePerLight}}
  }

${opts.postLighting?.gl ?? ''}
{{lobePostLighting}}
}
`;

  return {
    name: opts.name,
    requires: opts.requires,
    structs: opts.structs,
    bindings: opts.bindings,
    textures: opts.textures,

    gpu: {
      header: opts.header?.gpu,
      fragment: { lighting: wgslLoop },
    },

    gl: {
      header: `${GL_GET_LIGHT_HELPER}\n${opts.header?.gl ?? ''}`,
      fragment: { lighting: glslLoop },
    },
  };
}
