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
 * Blending applied to a particle material
 *
 * The subset of pixi's `BLEND_MODES` the 3D pass can express as fixed-function
 * GPU blends. The advanced 2D modes (`'overlay'`, `'color-dodge'`, …) are
 * filter-based and have no meaning here.
 *
 * - `'normal'` composites over the scene — smoke, dust, debris
 * - `'add'` only brightens — fire, sparks, magic, anything that glows
 * - `'multiply'` only darkens — stains, shadowy wisps, dark smoke
 * - `'screen'` brightens softly, never clipping — glows and hazes
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
  /** How each quad is oriented before its corners expand @default 'spherical' */
  billboard?: ParticleBillboardMode;
  /**
   * Whether the geometry streams a per-particle `aParticleUVFrame` attribute,
   * for a system that picks frames at spawn
   *
   * Must match the geometry, and `texture` must then be the whole sheet,
   * unframed, so the derived uv transform is identity and the per-particle
   * frames own all UV remapping.
   * @default false
   */
  useFrames?: boolean;
  /** Whether particle centres are emitter-local rather than world-space @default false */
  localSpace?: boolean;
  /** How particles blend over the scene — see {@link ParticleBlendMode} @default 'normal' */
  blendMode?: ParticleBlendMode;
  /**
   * Which of the standard material alpha modes the particles use
   *
   * `'blend'` composites particles over the scene. `'mask'` makes hard cutouts
   * that write depth — no inter-system sorting artifacts, hidden fragments
   * early-z rejected instead of paying blend fill rate; the pick for leaves,
   * debris and stylized effects. `'opaque'` renders the whole quad solid —
   * only right for textures with no transparent texels (solid squares,
   * block-game debris), where it's the cheapest mode of all. `blendMode` only
   * applies under `'blend'`.
   * @default 'blend'
   */
  alphaMode?: AlphaMode;
  /** Coverage threshold for `'mask'` — texels below it are discarded @default 0.5 */
  alphaCutoff?: number;
  /** Extra shader bits composed after the particle bit — soft particles, custom fades */
  extraBits?: readonly ShaderBit[];
  /** Textures for the extra bits' declarations, by name, as `BaseMaterial3DOptions.textures` */
  textures?: Record<string, Texture | undefined>;
  /**
   * Whether the View's distance fog reaches these particles
   *
   * Defaults to the blend policy: `'normal'` particles fog like everything
   * else, every other mode opts out — fog lerps toward the fog colour, while
   * add/screen/multiply contributions should fade toward their neutral element
   * (black or white), so fogged quads would read as glowing or staining
   * rectangles.
   */
  fog?: boolean;
}

/**
 * The material half of a particle system: unlit flat shading with the particle
 * bit composed in
 *
 * Billboarding, per-particle size, rotation, tint and flipbook frame all read
 * from the streamed vertex layout. `alphaMode` supports the full triad — see
 * {@link ParticleMaterialOptions.alphaMode}; the mask cutoff is the only
 * shader variant.
 *
 * Built (and owned) by {@link ParticleContainer3D}, which derives the
 * `useFrames` / `localSpace` flags from its own geometry so the two halves of
 * the contract can't disagree. Reusable standalone only on geometry that
 * carries the same particle attribute layout. Blending lives on pixi state —
 * `material.state.blendMode` — and changing it on a rendering mesh needs that
 * mesh invalidated, which {@link ParticleContainer3D#blendMode} does for you.
 * @category scene
 * @advanced
 */
export class ParticleMaterial extends BaseMaterial3D {
  /** Unlit by definition — opt out of the View's tone-mapping curve */
  public override toneMapped = false;

  /** Unlit by definition; declares no lighting accumulators, so the view's env and shadow bits are skipped */
  public override lit = false;

  private readonly _bits: readonly ShaderBit[];

  constructor(options: ParticleMaterialOptions = {}) {
    const billboard = options.billboard ?? 'spherical';
    const useFrames = options.useFrames ?? false;
    const localSpace = options.localSpace ?? false;

    super({
      baseColorTexture: options.texture,
      // Blend routes through the transparent pass (no depth write, quads
      // composite); mask routes opaque with a cutoff discard and depth writes.
      alphaMode: options.alphaMode ?? 'blend',
      alphaCutoff: options.alphaCutoff,
      extraBits: options.extraBits,
      doubleSided: true,
      // Fog is only correct for 'normal': every other mode's neutral element
      // (black for add/screen, white for multiply) isn't the fog colour, so
      // fogged quads would read as glowing or staining rectangles.
      fog: options.fog ?? (options.blendMode ?? 'normal') === 'normal',
    });

    if (useFrames && options.texture !== undefined) {
      const { frame, source } = options.texture;

      // A framed texture would derive a uv transform on top of the frames.
      if (frame.x !== 0 || frame.y !== 0 || frame.width !== source.width || frame.height !== source.height) {
        throw new Error('[ParticleMaterial] useFrames needs the whole sheet as its texture, not one frame of it.');
      }
    }

    this._descriptor = new ShaderDescriptor({});

    // The same composition FlatMaterial assembles, plus the particle bit: base
    // colour sample, then the uv transform, then particle attributes — user
    // extras see the post-baseColor `albedo` / `alpha`. Fixed for the
    // material's lifetime, so the struct snapshot never shifts.
    this._bits = [
      flatMaterialBit,
      uvTransformBit,
      getParticleBit({ billboard, frames: useFrames, localSpace }),
      ...this._extraBits,
    ];
    this._deriveLayoutFromBits(this._bits, { baseColor: options.texture, ...options.textures });

    // Any blend mode but 'none' switches blending on, so mask and opaque keep
    // the state the alpha mode chose.
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
