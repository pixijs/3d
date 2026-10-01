import type { BufferImageSource } from 'pixi.js';

/**
 * Width, in texels, of every data texture a shader reads
 *
 * Stores are laid out `width = min(pixelCount, DATA_TEXTURE_WIDTH)` and grow in height, so a
 * store is always one of two shapes: a single row no wider than this, or exactly this wide.
 * That is what lets a shader turn a linear texel index into a 2D texel address with a mask and a
 * shift instead of a `textureSize()` fetch and an integer divide. See {@link glTexelAddress} and
 * {@link wgslTexelAddress}.
 *
 * The value is built into the generated GLSL and WGSL, so it's a contract between the allocators
 * here and the shader bits, not a tuning knob, and it has to be a power of two.
 *
 * WebGL2 only guarantees a `MAX_TEXTURE_SIZE` of 2048, so 4096 is also a requirement on the
 * device. WebGL2 devices in use support far more.
 * @internal
 */
export const DATA_TEXTURE_WIDTH = 4096;

/**
 * 32-bit words per texel of a store's data texture, which is `rgba32uint` or `rgba32float`
 * @internal
 */
export const WORDS_PER_TEXEL = 4;

/** 32-bit words in one full texture row */
const ROW_FLOATS = DATA_TEXTURE_WIDTH * WORDS_PER_TEXEL;

const INDEX_MASK = DATA_TEXTURE_WIDTH - 1;
const INDEX_SHIFT = Math.log2(DATA_TEXTURE_WIDTH);

/**
 * Rounds a store's float count up so a data texture over it covers whole rows
 *
 * A store past one row is `DATA_TEXTURE_WIDTH` wide with a whole number of rows, so a length that
 * ends partway through a row leaves the texture claiming texels the array doesn't have. Under one
 * row the texture is a single row exactly as long as the store, so small stores pay nothing. That
 * matters because every batch has its own mesh store, and one row is 64 KB.
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
  const pixelCount = floatCount / WORDS_PER_TEXEL;
  const width = Math.min(pixelCount, DATA_TEXTURE_WIDTH);

  return { width, height: Math.ceil(pixelCount / width) };
}

/**
 * Uploads texels `[start, end)` of a data texture
 *
 * pixi sends a range as up to three uploads: the partial first row, the whole rows between, and
 * the partial last row. Each upload has a fixed cost, so this widens a range of one row or more
 * to whole rows, which pixi sends as one upload. pixi sends the extra texels with the values
 * the backing array already holds. A shorter range stays exact.
 * @param source - The data texture's source.
 * @param start - First texel to upload.
 * @param end - One past the last texel to upload.
 * @internal
 */
export function uploadTexelRange(source: BufferImageSource, start: number, end: number): void {
  if (end - start >= DATA_TEXTURE_WIDTH) {
    start &= ~INDEX_MASK;
    end = (end + INDEX_MASK) & ~INDEX_MASK;
  }

  source.update(start, end);
}

/**
 * Uploads the texels covering floats `[start, end)` of a data texture's backing array
 *
 * A float range that doesn't start or end on a texel boundary rounds outward to whole texels.
 * A range of one row or more also widens to whole rows, as in {@link uploadTexelRange}.
 * @param source - The data texture's source.
 * @param start - First float to upload.
 * @param end - One past the last float to upload.
 * @internal
 */
export function uploadFloatRange(source: BufferImageSource, start: number, end: number): void {
  uploadTexelRange(source, Math.floor(start / WORDS_PER_TEXEL), Math.ceil(end / WORDS_PER_TEXEL));
}

/**
 * GLSL `ivec2` locating a linear texel index in a data texture
 *
 * Correct in both store shapes. At full width the mask and the shift split the index into column
 * and row. In a single narrower row every index is below the mask, so the mask changes nothing
 * and the shift gives 0.
 *
 * Written out because `% 4096` and `/ 4096` don't compile to the same thing: they're signed `int`
 * operations, which aren't a mask and a shift for a negative value, so the compiler adds a sign
 * correction it can't prove is dead. Store indices are never negative. The difference measured
 * about 20% of the fetch's cost on an M3 Max, and integer division costs relatively more on mobile.
 * @param index - GLSL expression producing a non-negative `int` texel index.
 * @returns The `ivec2` expression to pass to `texelFetch`.
 * @internal
 */
export function glTexelAddress(index: string): string {
  return `ivec2((${index}) & ${INDEX_MASK}, (${index}) >> ${INDEX_SHIFT})`;
}

/**
 * WGSL `vec2<i32>` locating a linear texel index in a data texture
 *
 * The WGSL twin of {@link glTexelAddress}. It uses the same mask and shift in place of a signed
 * divide, for the same reason.
 * @param index - WGSL expression producing a non-negative `i32` texel index.
 * @returns The `vec2<i32>` expression to pass to `textureLoad`.
 * @internal
 */
export function wgslTexelAddress(index: string): string {
  return `vec2<i32>((${index}) & ${INDEX_MASK}, (${index}) >> ${INDEX_SHIFT})`;
}
