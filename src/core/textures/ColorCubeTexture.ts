import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';

/**
 * Creates {@link CubeTexture}s filled with a solid color
 *
 * Useful for simple solid-color skyboxes or environment maps.
 * @example
 * ```ts
 * // Create a blue cube texture
 * const blueSky = ColorCubeTexture.from(0x87CEEB);
 *
 * // Create from RGB values
 * const redSky = ColorCubeTexture.fromRGB(255, 0, 0);
 *
 * // Use as a view's background skybox
 * view.background = blueSky;
 * ```
 * @category rendering
 * @standard
 */
export class ColorCubeTexture {
  /**
   * Creates a CubeTexture from a hex color value
   * @param color - Hex color value (e.g., 0xFF0000 for red, 0x87CEEB for sky blue)
   * @param alpha - Alpha value from 0-255 (default: 255)
   * @param label - Optional label for the texture
   * @returns A CubeTexture with all faces set to the specified color
   */
  public static from(color: number, alpha = 255, label?: string): CubeTexture {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    return this.fromRGB(r, g, b, alpha, label);
  }

  /**
   * Creates a CubeTexture from RGB(A) values
   * @param r - Red value (0-255)
   * @param g - Green value (0-255)
   * @param b - Blue value (0-255)
   * @param a - Alpha value (0-255, default: 255)
   * @param label - Optional label for the texture
   * @returns A CubeTexture with all faces set to the specified color
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
