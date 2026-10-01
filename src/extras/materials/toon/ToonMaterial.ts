import { definedProps } from 'pixi.js';

import { alphaMaskBit } from '../../../core/shader/bits/alphaMaskBit';
import { BaseMaterial3D } from '../../../materials/BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../../../materials/BaseMaterial3D';
import type { MaterialData } from '../../../materials/utils/createMaterialDataClass';
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
   * Size of the specular highlight, 0–1
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
 * The packed data shape {@link toonMaterialBit} produces
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
 * The material half of the toon look. Pair it with {@link OutlinePass} on the view for the ink
 * outline; every instance opts into that pass unless `outline: false` is passed.
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
