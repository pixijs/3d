import type { Texture } from 'pixi.js';

import { BaseMaterial3D } from '../../../materials/BaseMaterial3D';
import type { BaseMaterial3DOptions, ColorSpace } from '../../../materials/BaseMaterial3D';
import type { MaterialData } from '../../../materials/utils/createMaterialDataClass';
import type { MaterialTextures } from '../../../materials/utils/createMaterialTexturesClass';
import { portalBit } from './portalBit';

/**
 * Constructor options for {@link PortalMaterial}
 *
 * `baseColor` tints the feed.
 * @example
 * ```ts
 * const glassPortal: PortalMaterialOptions = { texture: feed, baseColor: 0xbfdcff };
 * const material = new PortalMaterial(glassPortal);
 * ```
 * @category extras:materials
 * @standard
 */
export interface PortalMaterialOptions extends BaseMaterial3DOptions {
  /**
   * The feed the portal shows, a render texture the size of the view
   *
   * Another aspect ratio stretches the far side, and matching the view's pixel size keeps it sharp.
   * In a view with a `'beforeToneMapping'` effect, give it an `rgba16float` format; see
   * {@link PortalPass}. The feed's alpha is ignored. Left out, the portal shows plain `baseColor`
   * until you set `material.textures.portal`.
   * @example
   * ```ts
   * const feed = RenderTexture.create({
   *   width: view3d.width,
   *   height: view3d.height,
   *   format: 'rgba16float',
   * });
   * const material = new PortalMaterial({ texture: feed });
   * ```
   */
  texture?: Texture;
}

/**
 * The fields of {@link PortalMaterial#data}
 * @category extras:materials
 * @advanced
 */
export interface PortalData extends MaterialData {
  /** The feed's tint in linear light, opacity in the last lane; set it with the material's `baseColor` and `alpha` */
  baseColor: Float32Array;
}

/**
 * Texture slots of a {@link PortalMaterial}, reached through its `textures`
 * @example
 * ```ts
 * const material = new PortalMaterial();
 * const slots: PortalMaterialTextures = material.textures;
 *
 * slots.portal = feed;
 * ```
 * @category extras:materials
 * @standard
 */
export interface PortalMaterialTextures extends MaterialTextures {
  /**
   * The feed the portal shows
   * @example
   * ```ts
   * portal.material.textures.portal = nextFeed;
   * ```
   */
  portal: Texture;
}

/**
 * Unlit surface that shows a render-texture feed at the viewer's own screen position
 *
 * Each fragment samples the feed where it sits on screen, so the far side holds still as the
 * viewer moves and the quad reads as an opening rather than a picture. Pair it with a
 * {@link PortalPass}, which draws the feed from behind the exit portal. The material needs nothing
 * from that pass but the texture, so a planar mirror's feed works too.
 *
 * The feed shows as the view drew it: unlit, and not tone mapped a second time as long as its
 * format suits the view (see {@link PortalMaterialOptions#texture}). The view's `exposure` still
 * scales it, on top of the exposure in the feed. A portal is an opening only from the side it
 * faces, so leave `doubleSided` off.
 *
 * On WebGL, a View3D drawn into a render texture, inside a pixi filter or by `renderer.extract`,
 * shows the far side upside down.
 * @example
 * ```ts
 * const feed = RenderTexture.create({
 *   width: view3d.width,
 *   height: view3d.height,
 *   format: 'rgba16float',
 * });
 * const entry = new Mesh3D({
 *   geometry: new PlaneGeometry({ width: 3, height: 4 }),
 *   material: new PortalMaterial({ texture: feed }),
 * });
 *
 * view3d.passes = [new PortalPass({ entry, exit, texture: feed })];
 * ```
 * @category extras:materials
 * @standard
 */
export class PortalMaterial extends BaseMaterial3D<PortalData, PortalMaterialTextures, PortalMaterialOptions> {
  /** @internal */
  public override _skipsToneCurve = true;

  /**
   * `'display'`: the portal only multiplies its feed by its tint, so it can skip the decode and encode
   * @advanced
   */
  public override colorSpace: ColorSpace = 'display';

  /**
   * `false`: the feed is a frame the view has already lit
   * @advanced
   */
  public override lit = false;

  constructor(options: PortalMaterialOptions = {}) {
    super({
      ...options,
      descriptor: { bitsGpu: [portalBit], bitsGl: [portalBit] },
      textures: { portal: options.texture, ...options.textures },
    });
  }

  /**
   * The base options plus the feed texture
   * @advanced
   */
  protected override _toOptions(): PortalMaterialOptions {
    return { ...super._toOptions(), texture: this.textures.portal };
  }
}
