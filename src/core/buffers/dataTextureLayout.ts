import { BufferImageSource } from 'pixi.js';

/**
 * Width of every data texture past one row; a power of two, since the shaders address a texel with
 * a mask and a shift. WebGL2 guarantees only 2048, so 4096 is a device requirement
 * @internal
 */
export const DATA_TEXTURE_WIDTH = 4096;

/** @internal */
export const WORDS_PER_TEXEL = 4;

const ROW_FLOATS = DATA_TEXTURE_WIDTH * WORDS_PER_TEXEL;

const INDEX_MASK = DATA_TEXTURE_WIDTH - 1;
const INDEX_SHIFT = Math.log2(DATA_TEXTURE_WIDTH);

/**
 * Rounds a float count past one row up to whole rows; a shorter one stays exact, as a row is 64 KB and
 * every batch has a store
 * @internal
 */
export function alignToDataTextureRows(floatCount: number): number {
  if (floatCount <= ROW_FLOATS || floatCount % ROW_FLOATS === 0) return floatCount;

  return floatCount + ROW_FLOATS - (floatCount % ROW_FLOATS);
}

/** @internal */
export function dataTextureSize(floatCount: number): { width: number; height: number } {
  const pixelCount = floatCount / WORDS_PER_TEXEL;
  const width = Math.min(pixelCount, DATA_TEXTURE_WIDTH);

  return { width, height: Math.ceil(pixelCount / width) };
}

/**
 * An `rgba32uint` view of the store: a small integer's bits read as a denormal float, which a float
 * fetch may flush to zero. Size the array with {@link alignToDataTextureRows}
 * @internal
 */
export function createDataTextureSource(data: Float32Array): BufferImageSource {
  const { width, height } = dataTextureSize(data.length);

  return new BufferImageSource({
    resource: new Uint32Array(data.buffer),
    width,
    height,
    format: 'rgba32uint',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
}

/**
 * Widens a range of a row or more to whole rows, which pixi sends as one upload rather than three
 * @internal
 */
export function uploadTexelRange(source: BufferImageSource, start: number, end: number): void {
  if (end - start >= DATA_TEXTURE_WIDTH) {
    start &= ~INDEX_MASK;
    end = (end + INDEX_MASK) & ~INDEX_MASK;
  }

  source.update(start, end);
}

/** @internal */
export function uploadFloatRange(source: BufferImageSource, start: number, end: number): void {
  uploadTexelRange(source, Math.floor(start / WORDS_PER_TEXEL), Math.ceil(end / WORDS_PER_TEXEL));
}

/**
 * A mask and a shift, not `%` and `/`, whose sign correction on an `int` costs about 20% of the fetch
 * @internal
 */
export function glTexelAddress(index: string): string {
  return `ivec2((${index}) & ${INDEX_MASK}, (${index}) >> ${INDEX_SHIFT})`;
}

/**
 * Masks and shifts for the reason {@link glTexelAddress} gives
 * @internal
 */
export function wgslTexelAddress(index: string): string {
  return `vec2<i32>((${index}) & ${INDEX_MASK}, (${index}) >> ${INDEX_SHIFT})`;
}
