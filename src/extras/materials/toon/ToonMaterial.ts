import { definedProps } from 'pixi.js';

import { alphaMaskBit } from '../../../core/shader/bits/alphaMaskBit';
import { BaseMaterial3D } from '../../../materials/BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../../../materials/BaseMaterial3D';
import type { MaterialData } from '../../../materials/utils/createMaterialDataClass';
import { toonMaterialBit, toonLightingBit } from './toonBit';

/**
 * Constructor options for {@link ToonMaterial}
 * @category extras:materials
 * @standard
 */
export interface ToonMaterialOptions extends BaseMaterial3DOptions {
  /**
   * Number of discrete diffuse shading bands
   * @default 3
   */
  bands?: number;
  /**
   * Size of the specular highlight, 0–1
   * @default 0.15
   */
  specularSize?: number;
  /**
   * Exponent controlling rim light width
   * @default 3
   */
  rimPower?: number;
  /**
   * Intensity of the rim light
   * @default 0.4
   */
  rimIntensity?: number;
  /**
   * Whether this material joins the `outline` pass — pair with {@link OutlinePass} on the view
   * @default true
   */
  outline?: boolean;
}

/**
 * The packed data shape `toonMaterialBit` produces
 *
 * `baseColor` and `alphaCutoff` are required because the bit always declares them.
 * @category extras:materials
 * @advanced
 */
export interface ToonData extends MaterialData {
  /** Base colour, linear RGBA */
  baseColor: Float32Array;
  /** Alpha below which a fragment is discarded in `mask` alpha mode */
  alphaCutoff: number;
  /** Number of discrete diffuse shading bands */
  bands: number;
  /** Size of the specular highlight, 0–1 */
  specularSize: number;
  /** Exponent controlling rim light width */
  rimPower: number;
  /** Intensity of the rim light */
  rimIntensity: number;
}

/**
 * Cel-shaded toon material — banded diffuse, a sharp specular highlight and a rim light
 *
 * The material half of the toon look. Pair it with {@link OutlinePass} on the view for the ink
 * outline; every instance opts into that pass unless `outline: false` is passed.
 * @category extras:materials
 * @standard
 */
export class ToonMaterial extends BaseMaterial3D<ToonData> {
  /**
   * Default {@link ToonMaterialOptions} merged under every constructor call
   *
   * `new ToonMaterial(opts)` resolves as `{ ...ToonMaterial.defaultOptions, ...opts }`. Mutate to change defaults
   * process-wide.
   * @example
   * ```ts
   * ToonMaterial.defaultOptions.bands = 4;
   * ```
   */
  public static defaultOptions: ToonMaterialOptions = {
    bands: 3,
    specularSize: 0.15,
    rimPower: 3,
    rimIntensity: 0.4,
    outline: true,
  };

  constructor(options: ToonMaterialOptions = {}) {
    const { bands, specularSize, rimPower, rimIntensity, outline, ...rest } = {
      ...ToonMaterial.defaultOptions,
      ...definedProps(options),
    };

    const bitsGpu = [toonMaterialBit, toonLightingBit];
    const bitsGl = [toonMaterialBit, toonLightingBit];
    if (rest.alphaMode === 'mask') {
      bitsGpu.push(alphaMaskBit);
      bitsGl.push(alphaMaskBit);
    }

    super({
      ...rest,
      descriptor: { bitsGpu, bitsGl },
      passes: {
        outline: outline!,
        ...rest.passes,
      },
    });

    this.data.bands = bands!;
    this.data.specularSize = specularSize!;
    this.data.rimPower = rimPower!;
    this.data.rimIntensity = rimIntensity!;
  }
}
