import type { BLEND_MODES, Texture } from 'pixi.js';

import { alphaMaskBit } from '../../core/shader/bits/alphaMaskBit';
import { uvTransformBit } from '../../core/shader/bits/uvTransformBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { ShaderDescriptor } from '../../core/shader/ShaderDescriptor';
import { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import type { AlphaMode } from '../../materials/BaseMaterial3D';
import { flatMaterialBit } from '../../materials/flat/bits/flatMaterialBit';
import type { View3D } from '../View3D';
import { getParticleBit } from './bits/particleBit';
import type { ParticleBillboardMode } from './bits/particleBit';

/**
 * How particles blend over the scene
 *
 * The pixi blend modes the GPU can do directly. The advanced 2D modes, such as `'overlay'` and
 * `'color-dodge'`, need filters and aren't available.
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
   * Must match the geometry. `texture` must then be the whole sheet, not one frame of it, so the
   * material's UV transform is identity and the per-particle windows do all the UV mapping;
   * `ParticleContainer3D` binds such a whole-sheet texture for a flipbook.
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
   * Ignored unless `alphaMode` is `'blend'`: pixi turns blending on for any blend mode but
   * `'none'`, which `'mask'` and `'opaque'` must keep off.
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
   * Defaults to `true` for `'normal'` blending only. Fog fades a particle toward the fog colour,
   * but an added or screened particle has to fade toward black to vanish, and a multiplied one
   * toward white, so fogged quads would show as glowing or staining rectangles.
   */
  fog?: boolean;
}

/**
 * The material half of a particle system: unlit, flat shading with the particle bit composed in
 *
 * Billboarding, and each particle's size, rotation, tint and flipbook frame, all come from the
 * particle vertex layout. Every `alphaMode` works; `'mask'` adds the cutoff to the shader.
 *
 * {@link ParticleContainer3D} builds and owns one, passing `useFrames` and `localSpace` to
 * match its own geometry. Use it on its own only with geometry that has the same particle
 * attributes. The blend mode lives on pixi's `material.state.blendMode`, and changing it on a
 * mesh that is already drawing needs that mesh invalidated, which
 * {@link ParticleContainer3D#blendMode} does for you.
 * @category scene
 * @advanced
 */
export class ParticleMaterial extends BaseMaterial3D {
  /** Unlit, so the view's tone mapping is skipped */
  public override toneMapped = false;

  /** Unlit, so the view's environment and shadow bits are skipped */
  public override lit = false;

  /**
   * The shader bits, fixed for the material's lifetime so the material data layout never shifts
   *
   * `FlatMaterial`'s composition plus the particle bit: base colour sample, UV transform, the
   * particle attributes, then the extra bits, which see the sampled `albedo` and `alpha`.
   * `ParticleContainer3D` builds its vertex layout from the particle bit and the extra bits
   * alone, since the first two declare no attributes; one that did would need adding there too.
   */
  private readonly _bits: readonly ShaderBit[];

  constructor(options: ParticleMaterialOptions = {}) {
    const billboard = options.billboard ?? 'spherical';
    const useFrames = options.useFrames ?? false;
    const localSpace = options.localSpace ?? false;

    super({
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

    this._descriptor = new ShaderDescriptor({});

    this._bits = [
      flatMaterialBit,
      uvTransformBit,
      getParticleBit({ billboard, frames: useFrames, localSpace }),
      ...this._extraBits,
    ];
    this._deriveLayoutFromBits(this._bits, { baseColor: options.texture, ...options.textures });

    if (this._alphaMode === 'blend') this.state.blendMode = options.blendMode ?? 'normal';
  }

  /**
   * The particle bit list, plus the cutoff discard when the mode is `'mask'`
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
}
