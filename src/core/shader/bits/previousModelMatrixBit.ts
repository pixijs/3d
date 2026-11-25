import { glTexelAddress } from '../../buffers/dataTextureLayout';
import type { ShaderBit } from '../ShaderBit';

/**
 * Declares `previousModelMatrix`, batch matrix included, in the vertex `input` slot. WebGL reads `storeTexel` from
 * `instanceFetchMaterialBitGl` in that slot, and the texture `globalBitGl` declares, as these bindings are WebGPU's alone
 * @internal
 */
export const previousModelMatrixBit: ShaderBit = {
  name: 'previousModelMatrix',
  bindings: {
    global: {
      uPreviousRenderableStorage: { type: 'storage<Renderable>', visibility: 'vertex' },
    },
  },
  gpu: {
    vertex: {
      input: /* wgsl */ `
  let previousModelMatrix = uPreviousRenderableStorage[0].transform * uPreviousRenderableStorage[inst.id].transform;`,
    },
  },
  gl: {
    vertex: {
      header: /* glsl */ `
      mat4 fetchPreviousTransform(int texel) {
        return mat4(
          uintBitsToFloat(texelFetch(uPreviousMeshStoreTexture, ${glTexelAddress('texel')}, 0)),
          uintBitsToFloat(texelFetch(uPreviousMeshStoreTexture, ${glTexelAddress('texel + 1')}, 0)),
          uintBitsToFloat(texelFetch(uPreviousMeshStoreTexture, ${glTexelAddress('texel + 2')}, 0)),
          uintBitsToFloat(texelFetch(uPreviousMeshStoreTexture, ${glTexelAddress('texel + 3')}, 0)));
      }
      `,
      input: /* glsl */ `
  mat4 previousModelMatrix = fetchPreviousTransform(0) * fetchPreviousTransform(storeTexel);`,
    },
  },
};

/** @internal */
export function readsPreviousModelMatrix(bit: ShaderBit): boolean {
  if (bit.name === previousModelMatrixBit.name) return true;
  const requires = bit.requires;
  if (!requires) return false;
  for (let i = 0; i < requires.length; i++) if (readsPreviousModelMatrix(requires[i])) return true;
  return false;
}
