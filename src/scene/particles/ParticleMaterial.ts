import type { BLEND_MODES, Texture } from 'pixi.js';

import { alphaMaskBit } from '../../core/shader/bits/alphaMaskBit';
import { uvTransformBit } from '../../core/shader/bits/uvTransformBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { ShaderDescriptor } from '../../core/shader/ShaderDescriptor';
import { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import type { AlphaMode, ColorSpace } from '../../materials/BaseMaterial3D';
import { flatMaterialBit } from '../../materials/flat/bits/flatMaterialBit';
import type { MaterialData } from '../../materials/utils/createMaterialDataClass';
import type { MaterialTextures } from '../../materials/utils/createMaterialTexturesClass';
import type { View3D } from '../View3D';
import { getParticleBit } from './bits/particleBit';
import type { ParticleBillboardMode } from './bits/particleBit';

/**
 * How particles blend over the scene; pixi's advanced modes, such as `'overlay'`, aren't available
 *
 * - `'normal'` covers what's behind: smoke, dust, debris
 * - `'add'` only brightens: fire, sparks, magic, anything that glows
 * - `'multiply'` only darkens: stains, shadowy wisps, dark smoke
 * - `'screen'` brightens softly without blowing out: glows and hazes
 * @example
 * ```ts
 * const blendMode: ParticleBlendMode = glowing ? 'add' : 'normal';
 * const particles = new ParticleSystem3D({ blendMode });
 * ```
 * @category scene
 * @standard
 */
export type ParticleBlendMode = Extract<BLEND_MODES, 'normal' | 'add' | 'multiply' | 'screen'>;

/**
 * Constructor options for {@link ParticleMaterial}
 * @category scene
 * @advanced
 */
export interface ParticleMaterialOptions {
  /**
   * Name for debugging and for finding the material
   * @example
   * ```ts
   * new ParticleMaterial({ label: 'sparks' });
   * ```
   */
  label?: string;
  /** The sprite (or whole sprite sheet, for flipbooks) every particle samples */
  texture?: Texture;
  /**
   * How each quad faces the camera
   * @default 'spherical'
   */
  billboard?: ParticleBillboardMode;
  /**
   * Whether the geometry carries a per-particle `aParticleUVFrame` flipbook window
   *
   * `texture` must then be the whole sheet, not one frame of it, or the constructor throws.
   * @default false
   */
  useFrames?: boolean;
  /**
   * Whether particle positions are relative to the mesh rather than in world space
   * @default false
   */
  localSpace?: boolean;
  /**
   * How particles blend over the scene; see {@link ParticleBlendMode}
   *
   * Ignored unless `alphaMode` is `'blend'`.
   * @default 'normal'
   */
  blendMode?: ParticleBlendMode;
  /**
   * How particle transparency works; see {@link ParticleContainer3DOptions.alphaMode}
   * @default 'blend'
   */
  alphaMode?: AlphaMode;
  /**
   * Alpha below which a texel is cut away under `alphaMode: 'mask'`
   * @default 0.5
   */
  alphaCutoff?: number;
  /** Extra shader bits composed after the particle bit; see {@link ParticleContainer3DOptions.extraBits} */
  extraBits?: readonly ShaderBit[];
  /** Textures for the extra bits' declarations, by name, as `BaseMaterial3DOptions.textures` */
  textures?: Record<string, Texture | undefined>;
  /**
   * Whether the view's fog reaches these particles
   *
   * Defaults to `true` for `'normal'` blending only, since fog would show other blend modes' quads
   * as glowing or staining rectangles.
   */
  fog?: boolean;
}

/**
 * The unlit material {@link ParticleContainer3D} builds for its particles
 *
 * Use it yourself only on geometry with the same particle attributes, and `useFrames` and
 * `localSpace` to match. Its blend mode is `material.state.blendMode`; after changing that on a
 * mesh that's already drawing, call the mesh's `invalidate()`, which
 * {@link ParticleContainer3D#blendMode} does for you.
 * @category scene
 * @advanced
 */
export class ParticleMaterial extends BaseMaterial3D<MaterialData, MaterialTextures, ParticleMaterialOptions> {
  /** `'display'`, since particles only multiply their colours */
  public override colorSpace: ColorSpace = 'display';

  /** `false`: lights and shadows don't reach particles */
  public override lit = false;

  /**
   * Never changes, so the data layout can't shift; `ParticleContainer3D._attributes` lays out the
   * attributes of all but the first two, which declare none
   */
  private readonly _bits: readonly ShaderBit[];

  private readonly _billboard: ParticleBillboardMode;
  private readonly _useFrames: boolean;
  private readonly _localSpace: boolean;

  constructor(options: ParticleMaterialOptions = {}) {
    const billboard = options.billboard ?? 'spherical';
    const useFrames = options.useFrames ?? false;
    const localSpace = options.localSpace ?? false;

    super({
      label: options.label,
      baseColorTexture: options.texture,
      alphaMode: options.alphaMode ?? 'blend',
      alphaCutoff: options.alphaCutoff,
      extraBits: options.extraBits,
      doubleSided: true,
      fog: options.fog ?? (options.blendMode ?? 'normal') === 'normal',
    });

    if (useFrames && options.texture !== undefined) {
      const { frame, source } = options.texture;

      if (frame.x !== 0 || frame.y !== 0 || frame.width !== source.width || frame.height !== source.height) {
        throw new Error('[ParticleMaterial] useFrames needs the whole sheet as its texture, not one frame of it.');
      }
    }

    this._billboard = billboard;
    this._useFrames = useFrames;
    this._localSpace = localSpace;
    this._descriptor = new ShaderDescriptor({});

    this._bits = [
      flatMaterialBit,
      uvTransformBit,
      getParticleBit({ billboard, frames: useFrames, localSpace }),
      ...this.extraBits,
    ];
    this._deriveLayoutFromBits(this._bits, { baseColor: options.texture, ...options.textures });

    if (this._alphaMode === 'blend') this.state.blendMode = options.blendMode ?? 'normal';
  }

  /**
   * The particle shader, with the alpha cutoff under `alphaMode: 'mask'`
   * @param _view - Unused; the descriptor is the same in every view
   */
  public override getPrimaryDescriptor(_view: View3D): ShaderDescriptor {
    if (!this._variantDirty) return this._descriptor!;

    const bits = this._bits.slice();

    if (this._alphaMode === 'mask') bits.push(alphaMaskBit);

    this._descriptor!.update({ bitsGpu: bits, bitsGl: bits });
    this._variantDirty = false;

    return this._descriptor!;
  }

  /**
   * The options a particle material takes, read back: its sheet, the three that pick the particle
   * bit, the blend and alpha modes, fog and its extra bits' slots
   * @advanced
   */
  protected override _toOptions(): ParticleMaterialOptions {
    const { label, alphaMode, alphaCutoff, fog, textures } = super._toOptions();

    return {
      label,
      texture: this.textures.baseColor,
      billboard: this._billboard,
      useFrames: this._useFrames,
      localSpace: this._localSpace,
      blendMode: this.state.blendMode as ParticleBlendMode,
      alphaMode,
      alphaCutoff,
      fog,
      textures,
    };
  }
}
