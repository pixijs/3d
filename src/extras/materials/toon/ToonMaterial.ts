import { definedProps } from 'pixi.js';

import { alphaMaskBit } from '../../../core/shader/bits/alphaMaskBit';
import { BaseMaterial3D } from '../../../materials/BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../../../materials/BaseMaterial3D';
import type { MaterialData } from '../../../materials/utils/createMaterialDataClass';
import type { MaterialTextures } from '../../../materials/utils/createMaterialTexturesClass';
import { toonMaterialBit, toonLightingBit } from './toonBit';

/**
 * Constructor options for {@link ToonMaterial}
 * @example
 * ```ts
 * const flatShaded: ToonMaterialOptions = { bands: 1, rimIntensity: 0 };
 * const red = new ToonMaterial({ ...flatShaded, baseColor: 0xd94a3d });
 * const blue = new ToonMaterial({ ...flatShaded, baseColor: 0x3d6bd9 });
 * ```
 * @category extras:materials
 * @standard
 */
export interface ToonMaterialOptions extends BaseMaterial3DOptions {
  /**
   * Number of diffuse light steps above unlit: `1` shades a surface in two tones, `3` in four
   * @default 3
   * @example
   * ```ts
   * const twoTone = new ToonMaterial({ baseColor: 0x6ab04c, bands: 1 });
   * ```
   */
  bands?: number;
  /**
   * Size of the specular highlight, from 0 to 1
   * @default 0.15
   * @example
   * ```ts
   * const glossy = new ToonMaterial({ baseColor: 0xf4a259, specularSize: 0.3 });
   * ```
   */
  specularSize?: number;
  /**
   * Exponent of the rim light's falloff; higher values give a thinner rim
   * @default 3
   * @example
   * ```ts
   * const thinRim = new ToonMaterial({ baseColor: 0x4a69bd, rimPower: 6 });
   * ```
   */
  rimPower?: number;
  /**
   * Intensity of the rim light; `0` turns it off
   * @default 0.4
   * @example
   * ```ts
   * const noRim = new ToonMaterial({ baseColor: 0x4a69bd, rimIntensity: 0 });
   * ```
   */
  rimIntensity?: number;
  /**
   * Whether meshes with this material get the ink outline that an {@link OutlinePass} on the view
   * draws
   * @default true
   * @example
   * ```ts
   * const water = new ToonMaterial({ baseColor: 0x3fa7d6, outline: false });
   * ```
   */
  outline?: boolean;
}

/**
 * The fields of {@link ToonMaterial#data}
 * @category extras:materials
 * @advanced
 */
export interface ToonData extends MaterialData {
  /** Base colour in linear light, alpha in the last lane */
  baseColor: Float32Array;
  /** Cutoff for `alphaMode: 'mask'` */
  alphaCutoff: number;
  /** See {@link ToonMaterialOptions#bands} */
  bands: number;
  /** See {@link ToonMaterialOptions#specularSize} */
  specularSize: number;
  /** See {@link ToonMaterialOptions#rimPower} */
  rimPower: number;
  /** See {@link ToonMaterialOptions#rimIntensity} */
  rimIntensity: number;
}

/**
 * Cel-shaded toon material: banded diffuse, a sharp specular highlight and a rim light
 *
 * Add an {@link OutlinePass} to the view for ink outlines. To change `bands`, `specularSize`,
 * `rimPower` or `rimIntensity` after construction, set them on `material.data`.
 * @example
 * ```ts
 * const view3d = new View3D({ passes: [new OutlinePass({ width: 0.05 })] });
 * const hero = new Mesh3D({
 *   geometry: new SphereGeometry(),
 *   material: new ToonMaterial({ baseColor: 0xf4a259, bands: 2 }),
 * });
 *
 * view3d.root.addChild(hero);
 * ```
 * @category extras:materials
 * @standard
 */
export class ToonMaterial extends BaseMaterial3D<ToonData, MaterialTextures, ToonMaterialOptions> {
  /**
   * Defaults for every new `ToonMaterial`; an option passed as `undefined` keeps its default
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

  /**
   * The base options plus the band, specular and rim values, with the outline pass as `outline`
   * @advanced
   */
  protected override _toOptions(): ToonMaterialOptions {
    const options = super._toOptions();
    const { outline, ...passes } = options.passes ?? {};
    const { bands, specularSize, rimPower, rimIntensity } = this.data;

    return { ...options, passes, outline: !!outline, bands, specularSize, rimPower, rimIntensity };
  }
}
