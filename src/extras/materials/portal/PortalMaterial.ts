import type { Texture } from 'pixi.js';

import { BaseMaterial3D } from '../../../materials/BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../../../materials/BaseMaterial3D';
import type { MaterialData } from '../../../materials/utils/createMaterialDataClass';
import type { MaterialTextures } from '../../../materials/utils/createMaterialTexturesClass';
import { portalBit } from './portalBit';

/**
 * Constructor options for {@link PortalMaterial}
 * @category extras:materials
 * @standard
 */
export interface PortalMaterialOptions extends BaseMaterial3DOptions {
  /**
   * The feed this portal shows — a render texture the size of the view
   *
   * Swap it later through `material.textures.portal`. Left out, the slot starts on
   * `Texture.WHITE` and the quad reads as a flat white panel until a feed arrives.
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
 * The texture slots {@link PortalMaterial}'s derivation walk produces
 * @category extras:materials
 * @standard
 */
export interface PortalMaterialTextures extends MaterialTextures {
  /** The feed rendered by the portal camera */
  portal: Texture;
}

/**
 * Unlit surface that shows a render-texture feed at the viewer's own screen position
 *
 * The quad becomes an opening rather than a picture: because each fragment samples the feed
 * where it sits on screen, the far side stays put as the viewer moves, and the seam at the frame
 * lines up. Pair it with a `PortalPass`, which renders the feed from a camera mirrored through
 * the portal pair — but the material needs nothing from that pass beyond a texture, so it serves
 * a mirror or a fixed security feed just as well.
 *
 * Unlit and untone-mapped by definition: the feed is a finished frame, already lit and already
 * through the view's tone curve. Single-sided on purpose — a portal is only an opening from the
 * side it faces, and back-face culling is what says so.
 *
 * Draws the right way up on the canvas on both backends. One known gap: a View3D drawn into a
 * render texture on WebGL (inside a pixi filter, or `renderer.extract`) shows the far side
 * upside down — see {@link portalBit} for why.
 * @example
 * ```ts
 * const feed = RenderTexture.create({ width: view.width, height: view.height });
 * const portal = new Mesh3D({
 *   geometry: new PlaneGeometry({ width: 3, height: 4 }),
 *   material: new PortalMaterial({ texture: feed }),
 * });
 * ```
 * @see {@link portalBit} For the screen-position sampling and its per-backend Y handling.
 * @category extras:materials
 * @standard
 */
export class PortalMaterial extends BaseMaterial3D<PortalData, PortalMaterialTextures> {
  /** The feed carries the view's tone curve already — running it twice would crush the highlights */
  public override toneMapped = false;

  /** Nothing to light: the surface is a window onto an already-lit frame */
  public override lit = false;

  constructor(options: PortalMaterialOptions = {}) {
    super({
      ...options,
      descriptor: { bitsGpu: [portalBit], bitsGl: [portalBit] },
      textures: { portal: options.texture, ...options.textures },
    });
  }
}
