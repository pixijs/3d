import { alphaMaskBit } from '../../core/shader/bits/alphaMaskBit';
import { uvTransformBit } from '../../core/shader/bits/uvTransformBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { ShaderDescriptor } from '../../core/shader/ShaderDescriptor';
import type { View3D } from '../../scene/View3D';
import { BaseMaterial3D } from '../BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../BaseMaterial3D';
import { flatMaterialBit } from './bits/flatMaterialBit';

/**
 * Options for {@link FlatMaterial}, the same as {@link BaseMaterial3DOptions}
 *
 * `extraBits` run after the base colour and texture are applied and before the `'mask'` cutoff
 * test, so they see the textured `albedo` and `alpha`, and any alpha they write still reaches the
 * cutoff.
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
 * Lights, the view's environment, shadows and tone mapping all leave it alone, which suits UI
 * panels, icons, debug drawing and anything baked. The view's fog still applies unless `fog` is
 * `false`. `flatShading` has no visible effect, since nothing reads the normal.
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
   * `false`: a flat material skips the view's tone mapping
   * @advanced
   */
  public override toneMapped = false;

  /**
   * `false`: a flat material takes no part in lighting, so no shadow sampling is compiled in
   * @advanced
   */
  public override lit = false;

  constructor(options: FlatMaterialOptions = {}) {
    super(options);
    this._descriptor = new ShaderDescriptor({});

    const derivationBits = [flatMaterialBit, uvTransformBit, ...this._extraBits];
    this._deriveLayoutFromBits(derivationBits, {
      baseColor: options.baseColorTexture,
      ...options.textures,
    });
  }

  /**
   * The shader descriptor for this material, rebuilt after `alphaMode` moves to or from `'mask'`
   *
   * In `'mask'` mode the list gains `alphaMaskBit`. It adds no texture and needs only
   * `alphaCutoff`, which `flatMaterialBit` already declares, so the layout derived at construction
   * still holds.
   * @param _view - Unused; the descriptor is the same in every view.
   * @advanced
   */
  public override getPrimaryDescriptor(_view: View3D): ShaderDescriptor {
    if (!this._variantDirty) return this._descriptor!;

    const bits: ShaderBit[] = [flatMaterialBit, uvTransformBit];
    for (let i = 0; i < this._extraBits.length; i++) bits.push(this._extraBits[i]);
    if (this._alphaMode === 'mask') bits.push(alphaMaskBit);

    this._descriptor!.update({ bitsGpu: bits, bitsGl: bits });
    this._variantDirty = false;

    return this._descriptor!;
  }
}
