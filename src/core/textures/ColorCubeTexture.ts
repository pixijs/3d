import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';

/**
 * Makes {@link CubeTexture}s of one solid colour, for a plain background or a flat environment
 *
 * Each face is a single texel, so the cube costs almost no memory.
 * @example
 * ```ts
 * view3d.background = ColorCubeTexture.from(0x87ceeb);
 * view3d.environment = ColorCubeTexture.fromRGB(40, 44, 60);
 * ```
 * @category rendering
 * @standard
 */
export class ColorCubeTexture {
  /**
   * Creates a cube texture of one colour, given as a hex number
   * @example
   * ```ts
   * view3d.background = ColorCubeTexture.from(0x202830, 255, 'night-sky');
   * ```
   * @param color - Colour as `0xRRGGBB`
   * @param alpha - Alpha, from 0 to 255
   * @param label - Label for the cube; each face adds its side, as in `night-sky-left`
   * @returns A cube texture with every face set to the colour
   */
  public static from(color: number, alpha = 255, label?: string): CubeTexture {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    return this.fromRGB(r, g, b, alpha, label);
  }

  /**
   * Creates a cube texture of one colour, given as channels from 0 to 255
   * @example
   * ```ts
   * view3d.environment = ColorCubeTexture.fromRGB(255, 240, 220);
   * ```
   * @param r - Red, from 0 to 255
   * @param g - Green, from 0 to 255
   * @param b - Blue, from 0 to 255
   * @param a - Alpha, from 0 to 255
   * @param label - Label for the cube; each face adds its side, as in `night-sky-left`
   * @returns A cube texture with every face set to the colour
   */
  public static fromRGB(r: number, g: number, b: number, a = 255, label?: string): CubeTexture {
    const createFaceTexture = (faceName: string): Texture => {
      return new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array([r, g, b, a]),
          format: 'rgba8unorm',
          width: 1,
          height: 1,
          alphaMode: 'premultiply-alpha-on-upload',
          label: label ? `${label}-${faceName}` : `color-cube-${faceName}`,
        }),
        label: label ? `${label}-${faceName}` : `color-cube-${faceName}`,
      });
    };

    return CubeTexture.from({
      faces: {
        left: createFaceTexture('left'),
        right: createFaceTexture('right'),
        top: createFaceTexture('top'),
        bottom: createFaceTexture('bottom'),
        front: createFaceTexture('front'),
        back: createFaceTexture('back'),
      },
      label: label ?? 'color-cube-texture',
    });
  }
}
