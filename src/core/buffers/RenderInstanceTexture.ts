import { BufferImageSource, Texture } from 'pixi.js';

import { DATA_TEXTURE_WIDTH } from './dataTextureLayout';

/** `rgba32float` texels: `[storeIndex, slotsLo, slotsHi, spare]` */
const FLOATS_PER_INSTANCE = 4;

/**
 * A pass's compaction output as an `rgba32float` data texture — one texel per
 * drawn instance, holding the mesh store row to read and that instance's
 * packed texture slots, split into two exact 16-bit halves
 *
 * This is the WebGL form of the WebGPU `RenderInstanceBuffer`. Culling and
 * sorting produce a compacted, ordered survivor list whose rows are scattered
 * through the store, and WebGL2 has no `baseInstance` to point a draw at a
 * scattered slice, so the list has to be addressable from the shader:
 * `instanceFetchBitGl` reads texel `uInstanceBase + gl_InstanceID`, then reads
 * the store row it names.
 *
 * The packed slots stay here rather than in the store because they map a
 * material's textures onto *this* pass's batch texture units, and passes batch
 * differently (the shadow pass doesn't batch textures at all). They ride as
 * two 16-bit halves because the raw u32 has slot combinations whose bit
 * pattern is a NaN, which a float texture fetch may canonicalise; small
 * integers survive exactly.
 *
 * Integer texture formats would avoid the split, but pixi's
 * `mapFormatToGlFormat` pairs `rgba32uint` with `gl.RGBA` instead of
 * `gl.RGBA_INTEGER`, so WebGL rejects the upload.
 * @internal
 */
export class RenderInstanceTexture {
  /** Texture-backing CPU words, padded to whole texture rows */
  public data!: Float32Array;

  private _source!: BufferImageSource;
  private _texture!: Texture;
  private _capacity = 0;

  constructor(initialCapacity = 256) {
    this.ensureCapacity(initialCapacity);
  }

  /** The bindable texture view over the index list */
  public get texture(): Texture {
    return this._texture;
  }

  /** Capacity in instances */
  public get capacity(): number {
    return this._capacity;
  }

  /**
   * Ensures room for `instances` texels, reallocating and resizing on growth
   *
   * Contents are not preserved: the compaction rewrites every used texel before
   * each upload.
   * @param instances - Instance count to make room for.
   */
  public ensureCapacity(instances: number): void {
    if (instances <= this._capacity) return;

    let capacity = Math.max(256, this._capacity);
    while (capacity < instances) capacity *= 2;
    this._capacity = capacity;

    const width = Math.min(capacity, DATA_TEXTURE_WIDTH);
    const height = Math.ceil(capacity / width);

    this.data = new Float32Array(width * height * FLOATS_PER_INSTANCE);

    if (!this._source) {
      this._source = new BufferImageSource({
        resource: this.data,
        width,
        height,
        format: 'rgba32float',
        scaleMode: 'nearest',
        alphaMode: 'no-premultiply-alpha',
        label: 'InstanceIndex',
      });
      this._texture = new Texture({ source: this._source });
      return;
    }

    this._source.resource = this.data;
    if (this._source.width !== width || this._source.height !== height) {
      this._source.resize(width, height);
    }
  }

  /** Pushes the CPU texels to the GPU. Call after the compaction fill, before the draws that read it */
  public upload(): void {
    this._source.update();
  }

  /**
   * Frees the GPU copy of the texture while keeping the CPU texels
   *
   * pixi re-creates it from `data` on the next bind; the next compaction fill
   * rewrites the texels anyway. Idempotent.
   */
  public unload(): void {
    this._source?.unload();
  }

  /** Frees the texture and its source; drops the backing array. Idempotent */
  public destroy(): void {
    if (!this._texture) return;
    this._texture.destroy(true);
    (this._texture as Texture | null) = null;
    (this._source as BufferImageSource | null) = null;
    (this.data as Float32Array | null) = null;
  }
}
