import { BufferImageSource, Texture } from 'pixi.js';

import { DATA_TEXTURE_WIDTH, uploadTexelRange } from './dataTextureLayout';

const WORDS_PER_INSTANCE = 1;

/** Fills a new array, so the compaction, which writes only changed texels, finds every survivor changed */
const NO_ROW = 0xffffffff;

/**
 * WebGL2 has no `baseInstance`, so `instanceFetchBitGl` reads texel `uInstanceBase + gl_InstanceID`
 * for the store row; an integer format, since a float one could rewrite the bits
 * @internal
 */
export class RenderInstanceTexture {
  /** Matches the GPU copy, which lets the compaction skip unchanged texels, so upload every texel you change */
  public data!: Uint32Array;

  private _source!: BufferImageSource;
  private _texture!: Texture;
  private _capacity = 0;

  constructor(initialCapacity = 256) {
    this.ensureCapacity(initialCapacity);
  }

  public get texture(): Texture {
    return this._texture;
  }

  public get capacity(): number {
    return this._capacity;
  }

  public ensureCapacity(instances: number): void {
    if (instances <= this._capacity) return;

    let capacity = Math.max(256, this._capacity);
    while (capacity < instances) capacity *= 2;
    this._capacity = capacity;

    const width = Math.min(capacity, DATA_TEXTURE_WIDTH);
    const height = Math.ceil(capacity / width);

    this.data = new Uint32Array(width * height * WORDS_PER_INSTANCE).fill(NO_ROW);

    if (!this._source) {
      this._source = new BufferImageSource({
        resource: this.data,
        width,
        height,
        format: 'r32uint',
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

  public upload(start: number, end: number): void {
    if (start < end) uploadTexelRange(this._source, start, end);
  }

  public unload(): void {
    this._source?.unload();
  }

  public destroy(): void {
    if (!this._texture) return;
    this._texture.destroy(true);
    (this._texture as Texture | null) = null;
    (this._source as BufferImageSource | null) = null;
    (this.data as Uint32Array | null) = null;
  }
}
