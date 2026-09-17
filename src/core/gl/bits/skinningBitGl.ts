import { glTexelAddress } from '../../buffers/dataTextureLayout';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Skeletal animation for WebGL using bone matrices stored in a texture
 *
 * WebGL doesn't support storage buffers, so bone matrices are packed into
 * an RGBA32F texture and read with `texelFetch`.
 *
 * `bonePitIndex` is a local published by the active instance bit: this mesh's base
 * bone index inside the shared BonePit texture.
 * @internal
 */
export const skinningBitGl: ShaderBit = {
  name: 'skinningGl',
  attributes: {
    aJoints: 'uint8x4',
    aWeights: 'float32x4',
  },
  bindings: {
    global: {
      uBonePitTexture: 'texture_2d<f32>',
    },
  },
  gl: {
    vertex: {
      header: `
        // Three rows of four, not a mat4: a bone matrix is affine, so its fourth row is
        // always (0, 0, 0, 1). Twelve floats instead of sixteen is three texels instead of
        // four, and blending rows is a quarter less work than blending mat4s.
        void getBoneRows(uint jointIndex, uint bonePitIndex, out vec4 r0, out vec4 r1, out vec4 r2) {
          int baseTexel = int(bonePitIndex + jointIndex) * 3;

          r0 = texelFetch(uBonePitTexture, ${glTexelAddress('baseTexel')}, 0);
          r1 = texelFetch(uBonePitTexture, ${glTexelAddress('baseTexel + 1')}, 0);
          r2 = texelFetch(uBonePitTexture, ${glTexelAddress('baseTexel + 2')}, 0);
        }
      `,
      input: `
        vec4 skinRow0, skinRow1, skinRow2;
        vec4 b0, b1, b2;

        getBoneRows(uint(aJoints.x), uint(bonePitIndex), b0, b1, b2);
        skinRow0 = b0 * aWeights.x;
        skinRow1 = b1 * aWeights.x;
        skinRow2 = b2 * aWeights.x;

        getBoneRows(uint(aJoints.y), uint(bonePitIndex), b0, b1, b2);
        skinRow0 += b0 * aWeights.y;
        skinRow1 += b1 * aWeights.y;
        skinRow2 += b2 * aWeights.y;

        getBoneRows(uint(aJoints.z), uint(bonePitIndex), b0, b1, b2);
        skinRow0 += b0 * aWeights.z;
        skinRow1 += b1 * aWeights.z;
        skinRow2 += b2 * aWeights.z;

        getBoneRows(uint(aJoints.w), uint(bonePitIndex), b0, b1, b2);
        skinRow0 += b0 * aWeights.w;
        skinRow1 += b1 * aWeights.w;
        skinRow2 += b2 * aWeights.w;

        // Row-major affine: transforming a point is three dot products, and the w the mat4
        // form would compute is always 1. Direction vectors use the rotation part only.
        position = vec4(dot(skinRow0, position), dot(skinRow1, position), dot(skinRow2, position), position.w);
        normal = vec3(dot(skinRow0.xyz, normal), dot(skinRow1.xyz, normal), dot(skinRow2.xyz, normal));
        tangent = vec3(dot(skinRow0.xyz, tangent), dot(skinRow1.xyz, tangent), dot(skinRow2.xyz, tangent));
      `,
    },
  },
};
