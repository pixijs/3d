import type { Texture } from 'pixi.js';

import { BaseMaterial3D } from '../../../materials/BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../../../materials/BaseMaterial3D';
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
   * The feed this portal shows, a render texture the size of the view
   *
   * Swap it later through `material.textures.portal`. Left out, the slot starts on
   * `Texture.WHITE` and the quad reads as a flat white panel until a feed arrives.
   * @example
   * ```ts
   * const feed = RenderTexture.create({ width: view3d.width, height: view3d.height });
   * const material = new PortalMaterial({ texture: feed });
   * ```
   */
  texture?: Texture;
}

/**
 * The packed data shape {@link portalBit} produces
 * @category extras:materials
 * @advanced
 */
export interface PortalData extends MaterialData {
  /** Tint applied to the feed, linear RGBA; the alpha lane is the opening's own opacity */
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
 * The quad reads as an opening rather than a picture. Each fragment samples the feed where it
 * sits on screen, so the far side stays put as the viewer moves and lines up with the frame. Pair
 * it with a {@link PortalPass}, which renders the feed from a camera mirrored through the portal
 * pair. The material needs nothing from that pass but a texture, so a planar mirror's feed works
 * just as well.
 *
 * It skips lighting and tone mapping, because the feed is a finished frame that the view already
 * lit and tone-mapped. It is single-sided on purpose: a portal is only an opening from the side
 * it faces, and back-face culling enforces that.
 *
 * It draws the right way up on the canvas on both backends. One known gap: a View3D drawn into a
 * render texture on WebGL (inside a pixi filter, or `renderer.extract`) shows the far side upside
 * down. {@link portalBit} explains why.
 * @example
 * ```ts
 * const feed = RenderTexture.create({ width: view3d.width, height: view3d.height });
 * const entry = new Mesh3D({
 *   geometry: new PlaneGeometry({ width: 3, height: 4 }),
 *   material: new PortalMaterial({ texture: feed }),
 * });
 *
 * view3d.passes = [new PortalPass({ entry, exit, texture: feed })];
 * ```
 * @see {@link portalBit} For the screen-position sampling and its per-backend Y handling.
 * @category extras:materials
 * @standard
 */
export class PortalMaterial extends BaseMaterial3D<PortalData, PortalMaterialTextures> {
  /**
   * Off, because the feed already went through the view's tone curve and a second pass would
   * crush its highlights
   * @advanced
   */
  public override toneMapped = false;

  /**
   * Off, because the surface is a window onto a frame that is already lit
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
}
