import type { ShaderBit } from '../ShaderBit';

/** @internal */
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
