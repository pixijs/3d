import { alphaMaskBit } from '../../core/shader/bits/alphaMaskBit';
import { uvTransformBit } from '../../core/shader/bits/uvTransformBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { ShaderDescriptor } from '../../core/shader/ShaderDescriptor';
import type { View3D } from '../../scene/View3D';
import { BaseMaterial3D } from '../BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../BaseMaterial3D';
import { flatMaterialBit } from './bits/flatMaterialBit';

/**
 * Constructor options for {@link FlatMaterial}, identical to {@link BaseMaterial3DOptions}
 *
 * `extraBits` sit between `flatMaterialBit` (the base-colour sample) and `alphaMaskBit` (the
 * cutout discard), so user bits see the post-base-colour `albedo` / `alpha`, and any further
 * alpha modulation flows through to the cutout test.
 * @category materials
 * @standard
 */
export type FlatMaterialOptions = BaseMaterial3DOptions;

/**
 * Unlit, flat-shaded material
 *
 * Renders base color (factor * texture) with no lighting, IBL, or tone mapping. `alphaCutoff`
 * comes from {@link BaseMaterial3D}.
 *
 * The bit list rebuilds when `alphaMode` toggles through `mask`; `uvTransformBit` is
 * unconditional — the transform defaults to identity, derives automatically from a framed
 * baseColor texture, and an explicit `uvTransform` matrix overrides derivation. The Material
 * struct stays fixed for the material's lifetime.
 * @category materials
 * @standard
 */
export class FlatMaterial extends BaseMaterial3D {
  /** Unlit by definition — opt out of the View's tone-mapping curve */
  public override toneMapped = false;

  /** Unlit by definition — declares no lighting accumulators, so view-level lighting bits (env, shadow) are skipped */
  public override lit = false;

  constructor(options: FlatMaterialOptions = {}) {
    super(options);
    this._descriptor = new ShaderDescriptor({});

    // Slot layout derives from the texture-bearing bits in descriptor order
    // (alphaMaskBit declares no textures or unique fields, so its runtime
    // toggle disturbs neither slots nor struct). extraBits' own `textures`
    // declarations resolve from the name-keyed `textures` option, making
    // texture-sampling extra bits first-class. uvTransformBit is
    // unconditional so the struct snapshot always covers its fields.
    const derivationBits = [flatMaterialBit, uvTransformBit, ...this._extraBits];
    this._deriveLayoutFromBits(derivationBits, {
      baseColor: options.baseColorTexture,
      ...options.textures,
    });
  }

  /**
   * Rebuilds the flat bit list when the variant is dirty (e.g. `alphaMode` toggled through `'mask'`)
   * @param _view - Unused; flat shading composes no view-dependent bits.
   * @returns The material's primary shader descriptor.
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
