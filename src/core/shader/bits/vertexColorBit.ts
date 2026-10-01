import type { ShaderBit } from '../ShaderBit';

/**
 * Multiplies `albedo` and `alpha` by the vertex colour, `aColor`
 *
 * The renderer adds it when the geometry has `aColor` and the material turns on
 * {@link BaseMaterial3D#vertexColors}. The template starts `albedo` and `alpha` at 1, and the
 * material bits multiply onto them too. It runs ahead of the material's own bits so that
 * `pbrMaterialBit` works out a metal's F0, `mix(F0, albedo, metallic)`, from the tinted albedo, and
 * metals take the vertex colour.
 *
 * The shader reads four components, and `Geometry3D` stores colours four to a vertex, so the glTF
 * loader widens `VEC3` colours to RGBA with an opaque alpha (`widenColorToRgba`). A normalized
 * integer format such as `unorm8x4` reaches the shader as floats from 0 to 1.
 *
 * Vertex colours are linear, as glTF defines `COLOR_n`, so an sRGB-painted asset needs converting
 * when it's imported.
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
