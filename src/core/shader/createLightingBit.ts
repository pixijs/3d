import { MAX_LIGHTS } from '../../scene/View3D';
import type { ShaderBit } from './ShaderBit';

// GLSL helper that unpacks one light from the flat `uLightData` uniform array
// into a `Light` struct. WebGL has no storage buffers, so lights are uploaded
// as 4 vec4s per light (see `LightDataListBuffer` for the layout). WebGPU
// reads `uLightStorage[i]` directly in the loop, so no equivalent is needed.
//
// Wrapped in an include-guard macro so multiple factory-produced lighting
// bits in the same shader (unusual but possible) don't re-declare it.
const GL_GET_LIGHT_HELPER = /*glsl*/ `
#ifndef PIXI3D_GET_LIGHT_DEFINED
#define PIXI3D_GET_LIGHT_DEFINED
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
  l.range = d1.w;
  l.direction = d2.xyz;
  l.coneCos = d2.w;
  l.innerConeCos = d3.x;
  l.shadowDataIndex = d3.y;
  return l;
}
#endif
`;

/**
 * Options for {@link createLightingBit}
 *
 * ## What this factory does
 *
 * Every lighting model (PBR, toon, Blinn-Phong, rim-only, etc.) iterates the
 * same list of scene lights, dispatches on light type, applies the same
 * distance / range / cone attenuation, and samples the same shadow maps.
 * Only the shading math in the middle differs. This factory owns the shared
 * light-loop boilerplate — you supply just the math.
 *
 * Roughly, the generated fragment `lighting` slot looks like this:
 *
 * ```text
 *   {{preLighting}}                 // your init code (accumulators, hoisted math)
 *   for (i in 0..lightCount) {
 *     // factory resolves the light:
 *     //   light, lightDir, attenuation   (attenuation > 0 or continue)
 *     //   nDotL                          (nDotL > 0 or continue)
 *     //   shadow                         (result of calculateShadow(...))
 *     {{perLight}}                  // your shading math for one light
 *   }
 *   {{postLighting}}                // your final color assembly
 * ```
 *
 * ## Writing a new lighting model: the cheat sheet
 *
 * 1. In `preLighting`, declare and zero whatever accumulators your model
 *    needs (`diffuseLight`, `specLight`, `directLight`…). Also hoist any
 *    per-fragment math that doesn't depend on the light (e.g. `nDotV`,
 *    roughness-derived constants).
 *
 * 2. In `perLight`, read the contract variables the factory already set up
 *    (see table below) and accumulate this light's contribution. This code
 *    runs *inside* a for-loop, so:
 *       - you can declare local `let` / `float` vars freely — each iteration
 *         gets a fresh scope,
 *       - `continue;` is fine if you want to bail on a specific light,
 *       - the factory has already skipped lights with `attenuation <= 0` and
 *         back-facing fragments (`nDotL <= 0`), so you never see them.
 *
 * 3. In `postLighting`, assemble `finalColor` from your accumulators (plus
 *    `ambient`, `emissive`, `occlusion` if you want them — those come from
 *    earlier bits). `finalColor: vec3<f32>` / `vec3` is the template's
 *    output slot; whatever you write there reaches the tone-mapper.
 *
 * ## Contract variables available to `perLight`
 *
 * Both WGSL and GLSL. The factory papers over backend differences (WGSL
 * uses `input.vPosition` / `light.kind`; GLSL uses `vPosition` / `light.type`)
 * — your `perLight` shouldn't need to know which backend it's compiling for.
 *
 * | Name          | Type         | Where it comes from                        |
 * |---------------|--------------|--------------------------------------------|
 * | `light`       | `Light`      | factory (current iteration's light struct) |
 * | `lightDir`    | `vec3`       | factory (normalized fragment → light)      |
 * | `attenuation` | `f32`        | factory (distance × range × cone, > 0)     |
 * | `nDotL`       | `f32`        | factory (`max(dot(normal, lightDir), 0)`, > 0) |
 * | `shadow`      | `f32`        | factory (1.0 = lit, 0.0 = shadowed)        |
 * | `normal`      | `vec3`       | **upstream material bit** (world-space)    |
 * | `viewDir`     | `vec3`       | **upstream material bit** (normalized)     |
 *
 * Anything else your model needs (e.g. `albedo`, `roughness`, `fresnelF0` for
 * PBR; `bands`, `specularSize` for toon) should be declared by whatever
 * material bit runs before this one and left in scope for `perLight` / the
 * post-loop slot to read.
 *
 * ## Lobes (optional extra BRDF terms)
 *
 * Sibling bits in the descriptor can splice extra per-light math into this
 * loop *without* spawning a second `for (i in lights)` loop — important
 * because the loop's shadow sample is the most expensive step. To do so, a
 * bit emits into three nested fragment slots:
 *
 *   - `gpu.fragment.lobePreLighting`  / `gl.fragment.lobePreLighting`
 *   - `gpu.fragment.lobePerLight`     / `gl.fragment.lobePerLight`
 *   - `gpu.fragment.lobePostLighting` / `gl.fragment.lobePostLighting`
 *
 * The host's templated body references these as nested template markers
 * (`{{fragmentLobePerLight}}` in WGSL, `{{lobePerLight}}` in GLSL — the
 * stage-prefix asymmetry comes from how each backend's stage-slot plugin
 * names things; lobe authors don't need to think about it because they emit
 * into `fragment.lobePerLight` and the right marker resolves automatically
 * via `fillTemplateSlots`'s second substitution pass).
 *
 * **Execution order:** the host's `perLight` always runs first inside each
 * iteration, then lobes' `perLight` snippets run in **bit-declaration order**
 * (i.e. the order Material3D pushes them into the descriptor). Same ordering
 * applies to `preLighting` and `postLighting`. So a lobe's `postLighting` can
 * assume `finalColor` is already assembled and rewrite it — clearcoat uses
 * this to attenuate the base lobe by its Fresnel before adding its own term.
 *
 * ## Light-kind constants
 *
 * The global bit declares three named constants you can use to branch on
 * light type without hard-coding numeric values:
 *
 * | Name                | Value | Matches                  |
 * |---------------------|-------|--------------------------|
 * | `LIGHT_DIRECTIONAL` | `0.0` | `DirectionalLight`       |
 * | `LIGHT_POINT`       | `1.0` | `PointLight`             |
 * | `LIGHT_SPOT`        | `2.0` | `SpotLight`              |
 *
 * Usage (WGSL or GLSL):
 *
 * ```wgsl
 * if (light.kind == LIGHT_DIRECTIONAL) {
 *   // sun-specific math (e.g. sharper toon bands)
 * }
 * ```
 *
 * ## Prerequisites
 *
 * Consuming descriptor must include the global bit (every 3D descriptor
 * does). The global bit provides the `Light` struct and the light storage:
 *   - WebGPU: `uLightStorage: storage<Light>` (read in the loop)
 *   - WebGL:  `uLightData: array<vec4, MAX_LIGHTS*4>` (unpacked by the
 *     `getLight(int)` helper this factory emits into the GL fragment header)
 * @category rendering
 * @advanced
 */
export interface CreateLightingBitOptions {
  /** Used as the `ShaderBit.name` — appears in generated shader comments and compile errors */
  name: string;

  /** Extra bindings merged into the returned ShaderBit — use for custom uniforms your model needs */
  bindings?: ShaderBit['bindings'];
  /** Extra structs merged into the returned ShaderBit */
  structs?: ShaderBit['structs'];
  /** Texture slots this lighting model declares (e.g. a custom LUT) */
  textures?: string[];

  /**
   * Code appended to the fragment `header` slot — helper functions, constants
   *
   * Useful for BRDF helpers (`D_GGX`, `G_Smith`, `F_Schlick`, …) that you'd
   * rather not inline into `perLight`. Separate strings per backend because
   * WGSL and GLSL have different syntax.
   */
  header?: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };

  /**
   * Code that runs once, immediately before the light loop
   *
   * This is where you:
   *   - declare + zero your accumulators (`var directLight = vec3<f32>(0.0);`),
   *   - contribute to `ambient` if your model has one,
   *   - cache per-fragment math that doesn't depend on the light
   *     (e.g. `nDotV`, `a2 = roughness^4`).
   *
   * Any `let` / `float` you declare here is visible to `perLight` and
   * `postLighting` — they run in the same scope.
   */
  preLighting?: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };

  /**
   * **Required** — your per-light shading math, injected inside the light loop
   *
   * Read the contract variables (see the interface-level docs), compute this
   * light's contribution, and add it to whatever accumulators `preLighting`
   * declared.
   *
   * You can `continue;` to skip the rest of this iteration. The factory has
   * already filtered out zero-attenuation lights and back-facing fragments,
   * so this runs only for lights that will actually contribute.
   */
  perLight: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };

  /**
   * Code that runs once, immediately after the light loop
   *
   * This is where you assemble the final pixel color, typically into the
   * template's `finalColor` slot:
   * `finalColor = (ambient * occlusion) + directLight + emissive;`. Add any
   * post-fx terms that depend on aggregated state (rim light, fog, etc.)
   * here rather than inside the loop.
   */
  postLighting?: {
    /** WGSL source (WebGPU) */
    gpu?: string;
    /** GLSL source (WebGL) */
    gl?: string;
  };
}

/**
 * Builds a lighting `ShaderBit` from shading-math snippets
 *
 * Call once at module scope; the returned bit is a plain `ShaderBit` constant
 * that slots into any material's `bitsGpu` / `bitsGl` lists. See
 * {@link CreateLightingBitOptions} for the full contract.
 * @example Minimal Lambert (diffuse-only) — ~15 lines of real work
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
 *     gpu: 'finalColor = directLight + ambient * albedo + emissive;',
 *     gl:  'finalColor = directLight + ambient * albedo + emissive;',
 *   },
 * });
 * ```
 *
 * For richer examples, see:
 *   - `src/materials/pbr/bits/pbrLightingBit.ts` — Cook-Torrance BRDF
 *   - `src/extras/materials/toon/toonBit.ts` — cel-shaded diffuse + rim
 * @param opts - The lighting model's snippets and metadata
 * @returns The composed lighting bit
 * @category rendering
 * @advanced
 */
export function createLightingBit(opts: CreateLightingBitOptions): ShaderBit {
  // The outer `{ ... }` block isolates everything the lighting bit declares —
  // accumulators (`directLight`, `ambient`), hoisted BRDF math (`nDotV`, `a2`,
  // `vis_V`, `albedoOverPI`, …), and any lobe-declared locals (`clearcoatLight`,
  // `sheenLight`) — from the surrounding fragment body. Without it those names
  // would leak into whatever code follows the `{{fragmentLighting}}` slot and
  // could collide with unrelated bits' identifiers.
  //
  // The `{{...LobePreLighting}}` / `{{...LobePerLight}}` / `{{...LobePostLighting}}`
  // markers are nested template slots: any sibling bit that emits into
  // `gpu.fragment.lobePerLight` (etc.) will splice its code in here once
  // `fillTemplateSlots` runs its second substitution pass. With no such bits
  // present the markers expand to empty strings and the resulting shader is
  // byte-identical to a lighting-only build (modulo a few blank lines, which
  // the GLSL/WGSL compilers strip). See `clearcoatBit` for an example consumer.
  //
  // Marker name asymmetry between backends is unavoidable: WGSL stage slots
  // are stage-prefixed (`fragmentLobePerLight`); GLSL stage slots are raw
  // (`lobePerLight`). Same source-side authoring (`fragment.lobePerLight`),
  // different reference syntax in the host's templated body.
  const wgslLoop = /*wgsl*/ `
{
${opts.preLighting?.gpu ?? ''}
{{fragmentLobePreLighting}}

  let lightCountI = i32(global.uGlobalLightParams.w);

  for (var i: i32 = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= lightCountI) { break; }

    let light = uLightStorage[i];

    var lightDir: vec3<f32>;
    var attenuation: f32 = 1.0;

    if (light.kind == LIGHT_DIRECTIONAL) {
      // light.direction is pre-normalized on the CPU side (LightDataListBuffer).
      lightDir = -light.direction;
    } else {
      let toLight = light.position - input.vPosition;
      let distanceSq = dot(toLight, toLight);

      // Inverse-square falloff; distanceSq clamped to 0.01 to avoid the d->0 singularity.
      if (light.range > 0.0) {
        let rangeSq = light.range * light.range;
        // Early-out: fragment is outside the light's reach. Skips the rest of
        // the iteration (inverseSqrt, cone math, nDotL, shadow lookup, perLight).
        if (distanceSq >= rangeSq) { continue; }

        let distRatio = distanceSq / rangeSq;
        let windowFalloff = saturate(1.0 - distRatio * distRatio);
        attenuation = windowFalloff * windowFalloff / max(distanceSq, 0.01);
      } else {
        attenuation = 1.0 / max(distanceSq, 0.01);
      }

      lightDir = toLight * inverseSqrt(distanceSq);

      if (light.kind == LIGHT_SPOT) {
        // light.direction is pre-normalized on the CPU side (LightDataListBuffer).
        // coneCos = outer edge (light vanishes), innerConeCos = full-intensity edge.
        // max() guards the penumbra=0 case where the two collapse (hard edge).
        let spotCos = dot(-lightDir, light.direction);
        let spotAtten = saturate((spotCos - light.coneCos) / max(light.innerConeCos - light.coneCos, 1e-6));
        attenuation *= spotAtten * spotAtten;
      }
    }

    if (attenuation <= 0.0) { continue; }

    let nDotL = max(dot(normal, lightDir), 0.0);
    if (nDotL <= 0.0) { continue; }

    let shadow = calculateShadow(light, input.vPosition, normal, nDotL);

${opts.perLight.gpu ?? ''}
{{fragmentLobePerLight}}
  }

${opts.postLighting?.gpu ?? ''}
{{fragmentLobePostLighting}}
}
`;

  const glslLoop = /*glsl*/ `
{
${opts.preLighting?.gl ?? ''}
{{lobePreLighting}}

  int lightCountI = int(uGlobalLightParams.w);

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= lightCountI) break;

    Light light = getLight(i);

    vec3 lightDir;
    float attenuation = 1.0;

    if (light.type == LIGHT_DIRECTIONAL) {
      // light.direction is pre-normalized on the CPU side (LightDataListBuffer).
      lightDir = -light.direction;
    } else {
      vec3 toLight = light.position - vPosition;
      float distanceSq = dot(toLight, toLight);

      // Inverse-square falloff; distanceSq clamped to 0.01 to avoid the d->0 singularity.
      if (light.range > 0.0) {
        float rangeSq = light.range * light.range;
        // Early-out: fragment is outside the light's reach. Skips the rest of
        // the iteration (inversesqrt, cone math, nDotL, shadow lookup, perLight).
        if (distanceSq >= rangeSq) continue;

        float distRatio = distanceSq / rangeSq;
        float windowFalloff = clamp(1.0 - distRatio * distRatio, 0.0, 1.0);
        attenuation = windowFalloff * windowFalloff / max(distanceSq, 0.01);
      } else {
        attenuation = 1.0 / max(distanceSq, 0.01);
      }

      lightDir = toLight * inversesqrt(distanceSq);

      if (light.type == LIGHT_SPOT) {
        // light.direction is pre-normalized on the CPU side (LightDataListBuffer).
        // coneCos = outer edge (light vanishes), innerConeCos = full-intensity edge.
        // max() guards the penumbra=0 case where the two collapse (hard edge).
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
