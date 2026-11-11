import { alphaMaskBit } from '../../core/shader/bits/alphaMaskBit';
import { uvTransformBit } from '../../core/shader/bits/uvTransformBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { ShaderDescriptor } from '../../core/shader/ShaderDescriptor';
import type { View3D } from '../../scene/View3D';
import { BaseMaterial3D } from '../BaseMaterial3D';
import type { BaseMaterial3DOptions, ColorSpace } from '../BaseMaterial3D';
import { flatMaterialBit } from './bits/flatMaterialBit';

/**
 * Options for {@link FlatMaterial}, the same as {@link BaseMaterial3DOptions}
 *
 * `extraBits` run after the base colour and texture and before the `'mask'` cutoff, so they see the
 * textured `albedo` and `alpha`, and the cutoff sees any alpha they write.
 * @example
 * ```ts
 * const options: FlatMaterialOptions = { baseColorTexture: iconTexture, alphaMode: 'mask' };
 * const icon = new FlatMaterial(options);
 * ```
 * @category materials
 * @standard
 */
export type FlatMaterialOptions = BaseMaterial3DOptions;

/**
 * An unlit material that draws its base colour and texture with no lighting
 *
 * Lights, the view's environment and shadows leave it alone, which suits UI panels, icons, debug
 * drawing and anything baked. The view's exposure, fog and tone curve still apply: under the
 * default `toneMapping: 'none'` at exposure 1 it draws its colour and texture as authored,
 * multiplied the way a pixi sprite's tint is, while a curve such as `'aces'` shifts them.
 * @example
 * ```ts
 * const panel = new Mesh3D({
 *   geometry: new PlaneGeometry({ width: 2, height: 1 }),
 *   material: new FlatMaterial({ baseColorTexture: panelTexture }),
 * });
 * ```
 * @category materials
 * @standard
 */
export class FlatMaterial extends BaseMaterial3D {
  /**
   * `'display'`, since a flat material only multiplies its colours
   * @advanced
   */
  public override colorSpace: ColorSpace = 'display';

  /**
   * `false`: a flat material takes no part in lighting
   * @advanced
   */
  public override lit = false;

  constructor(options: FlatMaterialOptions = {}) {
    super(options);
    this._descriptor = new ShaderDescriptor({});

    const derivationBits = [flatMaterialBit, uvTransformBit, ...this.extraBits];
    this._deriveLayoutFromBits(derivationBits, {
      baseColor: options.baseColorTexture,
      ...options.textures,
    });
  }

  /**
   * The shader descriptor for this material, the same in every view
   * @param _view - Unused
   * @advanced
   */
  public override getPrimaryDescriptor(_view: View3D): ShaderDescriptor {
    if (!this._variantDirty) return this._descriptor!;

    const bits: ShaderBit[] = [flatMaterialBit, uvTransformBit];
    for (let i = 0; i < this.extraBits.length; i++) bits.push(this.extraBits[i]);
    if (this._alphaMode === 'mask') bits.push(alphaMaskBit);

    this._descriptor!.update({ bitsGpu: bits, bitsGl: bits });
    this._variantDirty = false;

    return this._descriptor!;
  }
}
