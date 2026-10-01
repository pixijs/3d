import { BufferImageSource, Texture } from 'pixi.js';

import { DATA_TEXTURE_WIDTH, uploadTexelRange } from './dataTextureLayout';

/** `u32`s per `rg32uint` texel: the store index and the packed texture slots */
const WORDS_PER_INSTANCE = 2;

/**
 * The instances a WebGL draw list draws, after culling, as an `rg32uint` data texture: one texel
 * per instance, holding its mesh store row and its packed texture slots
 *
 * The WebGL form of `RenderInstanceBuffer`. Culling and sorting leave a list of survivors whose
 * rows are scattered through the store, and WebGL2 has no `baseInstance` to start a draw partway
 * into an instance buffer, so the shader looks the list up: `instanceFetchBitGl` reads texel
 * `uInstanceBase + gl_InstanceID`, then the store row it names.
 *
 * The packed slots live here rather than in the store because they map a material's textures onto
 * one pass's bind group, and passes batch differently; the shadow pass batches no textures. Both
 * words are integers, so the format is an integer one: a float texture could flush or rewrite
 * their bit patterns on fetch.
 * @internal
 */
export class RenderInstanceTexture {
  /** The CPU texels, two `u32`s each, padded to whole texture rows */
  public data!: Uint32Array;

  private _source!: BufferImageSource;
  private _texture!: Texture;
  private _capacity = 0;

  constructor(initialCapacity = 256) {
    this.ensureCapacity(initialCapacity);
  }

  /** The texture to bind */
  public get texture(): Texture {
    return this._texture;
  }

  /** Capacity in instances */
  public get capacity(): number {
    return this._capacity;
  }

  /**
   * Makes room for `instances` texels, reallocating the array and resizing the texture to grow
   *
   * Growth doesn't keep the contents: the compaction rewrites every texel in use before each upload.
   * @param instances - Instance count to make room for.
   */
  public ensureCapacity(instances: number): void {
    if (instances <= this._capacity) return;

    let capacity = Math.max(256, this._capacity);
    while (capacity < instances) capacity *= 2;
    this._capacity = capacity;

    const width = Math.min(capacity, DATA_TEXTURE_WIDTH);
    const height = Math.ceil(capacity / width);

    this.data = new Uint32Array(width * height * WORDS_PER_INSTANCE);

    if (!this._source) {
      this._source = new BufferImageSource({
        resource: this.data,
        width,
        height,
        format: 'rg32uint',
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

  /**
   * Uploads the first `count` texels
   *
   * Call after the compaction fills them and before the draws that read them.
   * @param count - Slots the draw list staged, one texel each. Every texel a draw reads sits inside that range.
   */
  public upload(count: number): void {
    uploadTexelRange(this._source, 0, count);
  }

  /**
   * Frees the GPU copy of the texture and keeps the CPU texels
   *
   * pixi re-creates it from `data` on the next bind, and the next compaction rewrites the texels
   * anyway. Idempotent.
   */
  public unload(): void {
    this._source?.unload();
  }

  /** Frees the texture and its source and drops the CPU array. Idempotent */
  public destroy(): void {
    if (!this._texture) return;
    this._texture.destroy(true);
    (this._texture as Texture | null) = null;
    (this._source as BufferImageSource | null) = null;
    (this.data as Uint32Array | null) = null;
  }
}
