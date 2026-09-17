/**
 * Width, in texels, of every data texture the WebGL backend samples
 *
 * Stores are laid out `width = min(pixelCount, DATA_TEXTURE_WIDTH)` and grow in height, so a
 * store is always one of two shapes: a single row no wider than this, or exactly this wide.
 * That is what lets a shader turn a linear texel index into an `ivec2` with a mask and a
 * shift instead of a `textureSize()` fetch and an integer divide — see {@link glTexelAddress}.
 *
 * Because the value is baked into generated GLSL, it is a contract between the allocators
 * here and the shader bits, not a tuning knob. A power of two is load-bearing.
 *
 * WebGL2 only guarantees `MAX_TEXTURE_SIZE >= 2048`, so this is also a hard requirement on
 * the device. Every renderer in the wild clears it by a wide margin.
 * @internal
 */
export const DATA_TEXTURE_WIDTH = 4096;

/** Floats per texel — every data texture is `rgba32float` */
const FLOATS_PER_TEXEL = 4;

/** Floats covered by one full texture row */
const ROW_FLOATS = DATA_TEXTURE_WIDTH * FLOATS_PER_TEXEL;

const INDEX_MASK = DATA_TEXTURE_WIDTH - 1;
const INDEX_SHIFT = Math.log2(DATA_TEXTURE_WIDTH);

/**
 * Rounds a store's float count up so a data texture over it covers whole rows
 *
 * A store past one row is `DATA_TEXTURE_WIDTH` wide with `ceil` rows, so an unaligned
 * length leaves the texture claiming texels the array doesn't have. Under one row the
 * texture is `1 x pixelCount` and already exact, so small stores pay nothing — which
 * matters, since a mesh store is per-View3D and one row is 64 KB.
 * @param floatCount - Requested length in floats; must already be a multiple of 4.
 * @returns The same count, or the next whole-row multiple.
 * @internal
 */
export function alignToDataTextureRows(floatCount: number): number {
  if (floatCount <= ROW_FLOATS || floatCount % ROW_FLOATS === 0) return floatCount;

  return floatCount + ROW_FLOATS - (floatCount % ROW_FLOATS);
}

/**
 * Texture dimensions covering `floatCount` floats
 * @param floatCount - Length of the backing array in floats.
 * @returns Width and height in texels.
 * @internal
 */
export function dataTextureSize(floatCount: number): { width: number; height: number } {
  const pixelCount = floatCount / FLOATS_PER_TEXEL;
  const width = Math.min(pixelCount, DATA_TEXTURE_WIDTH);

  return { width, height: Math.ceil(pixelCount / width) };
}

/**
 * GLSL `ivec2` locating a linear texel index in a data texture
 *
 * Correct in both store shapes: at full width the mask and shift are exactly the row split;
 * in a single narrower row every index is below the mask, so the mask is the identity and
 * the shift yields 0.
 *
 * Worth writing out rather than trusting `% 4096` / `/ 4096` to compile to the same thing —
 * those are signed `int` operations, and neither is a mask or a shift for a negative value,
 * so the compiler emits sign correction it can't prove is dead. Store indices are never
 * negative. Measured at ~20% of fetch cost on an M3 Max, and integer division is relatively
 * more expensive on mobile.
 * @param index - GLSL expression producing a non-negative `int` texel index.
 * @returns The `ivec2` expression to pass to `texelFetch`.
 * @internal
 */
export function glTexelAddress(index: string): string {
  return `ivec2((${index}) & ${INDEX_MASK}, (${index}) >> ${INDEX_SHIFT})`;
}
