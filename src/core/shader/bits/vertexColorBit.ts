import type { ShaderBit } from '../ShaderBit';

/**
 * Vertex colour shader bit — declares the `aColor` attribute, the `vColor`
 * varying, the vertex-side publish, and the fragment-side modulation snippet
 *
 * Auto-injected by `MaterialSystemGpu`/`MaterialSystemGl` `ensureMaterial` when
 * the geometry has an `aColor` attribute. Users don't construct this directly.
 *
 * ## Modulation contract
 *
 * Tints `albedo` (and `alpha`) by multiplying. The template seeds
 * `albedo = vec3(1.0)` and `alpha = 1.0`, and every albedo-touching bit
 * (this one, `pbrMaterialBit`, `flatMaterialBit`, decals, ...) multiplies
 * onto the running value. The template runs `finalColor = albedo` after
 * the material slot to publish the unlit default; lighting bits
 * (`pbrLightingBit`) overwrite `finalColor` with the lit result.
 *
 * Pushed *before* the descriptor's material bits so that the metallic
 * specular F0 (`fresnelF0 = mix(F0, albedo, metallic)`, computed inside
 * `pbrMaterialBit` after its own `albedo *= baseColor.rgb;`) sees the
 * fully-tinted albedo. Metals correctly pick up vertex-colour tint.
 *
 * ## Format
 *
 * The `float32x4` declared below is the *shader-side* type. The buffer layout
 * comes from the geometry's own attribute format, and normalized integer
 * formats (`unorm8x4`, `unorm16x4`) resolve to the same `vec4<f32>` once the
 * hardware normalizes them, so those load and render correctly.
 *
 * Four components are required. glTF's `VEC3` color sets are widened to RGBA
 * by the loader (`widenColorToRgba`) rather than here, because the generic
 * VEC3 padding fills the fourth lane with zero — a transparent alpha.
 *
 * ## Colour space
 *
 * Vertex colours are treated as **linear** — matching the glTF spec and the
 * Khronos reference renderer. Authors converting from sRGB-painted assets
 * are responsible for the conversion at import time.
 * @internal
 */
export const vertexColorBit: ShaderBit = {
  name: 'vertexColor',
  attributes: {
    aColor: 'float32x4',
  },
  interStage: {
    vColor: 'vec4<f32>',
  },
  gpu: {
    vertex: {
      end: `output.vColor = input.aColor;`,
    },
    fragment: {
      material: `albedo *= input.vColor.rgb;
  alpha *= input.vColor.a;`,
    },
  },
  gl: {
    vertex: {
      end: `vColor = aColor;`,
    },
    fragment: {
      material: `albedo *= vColor.rgb;
  alpha *= vColor.a;`,
    },
  },
};
