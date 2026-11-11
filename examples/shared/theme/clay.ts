/**
 * Matte clay with a pale sheen, the surface of every shape in `shapes.ts`
 *
 * One material serves both themes: a theme changes the light, not the clay, so a toggle never swaps materials
 * under a batch. `ThemeStage` turns the sheen down and brightens orange to amber as it darkens, on every clay
 * material the kit made that is still alive, shared or your own.
 */

import { Material3D } from '@pixi/3d';
import type { AlphaMode, EmissiveOptions, EmissiveProps, ShaderBit } from '@pixi/3d';
import type { Texture } from 'pixi.js';

import { CLAY, DARK_ORANGE, mixColor } from './palette';
import type { ClayColor } from './palette';

/** How a shared clay material draws: see-through or two-sided, with shader bits of your own */
export interface ClayLookOptions {
  /** Your own shader bits, e.g. a vertex spin, composed into the clay shader */
  extraBits?: readonly ShaderBit[];
  /** `'blend'` for see-through clay, with {@link ClayLookOptions#alpha}. @default 'opaque' */
  alphaMode?: AlphaMode;
  /** The opacity of `'blend'` clay, 0 to 1, rounded to 0.01. @default 1 */
  alpha?: number;
  /** Draws back faces too, for a plane's back or the inside of an open shape. @default false */
  doubleSided?: boolean;
}

export interface ClayMaterialOptions extends ClayLookOptions {
  /** A clay colour name, or any 0xRRGGBB. @default 'white' */
  color?: ClayColor | number;
  /** A texture multiplied into the colour, e.g. a render texture you paint into */
  baseColorTexture?: Texture;
  /** A glow on top of the clay; `material.emissive.strength` stays writable. @default no glow */
  emissive?: EmissiveOptions;
}

/** Clay built with an `emissive` group, whose glow controls are always there */
export type GlowingClayMaterial = Material3D & { readonly emissive: EmissiveProps };

/** The sheen's tint at full strength: a pale lilac velvet at grazing angles */
const SHEEN = 0xe6e0f2;

/** The sheen left on the dark theme, where the rim that softens clay on paper reads as frost */
const DARK_SHEEN = 0.3;

/** Clay colours that muddy on a dark ground, and the brighter one each turns to there */
const DARK_COLORS: ReadonlyMap<number, number> = new Map([[CLAY.orange, DARK_ORANGE]]);

const cache = new Map<string, Material3D>();
/** Every clay material alive, shared or not, which {@link setClayDarkness} repaints */
const live = new Set<ClayMaterial>();
let darkness = 0;

function themed(hex: number): number {
  const dark = DARK_COLORS.get(hex);

  return dark === undefined ? hex : mixColor(hex, dark, darkness);
}

function sheenColor(): number {
  return mixColor(0, SHEEN, 1 + (DARK_SHEEN - 1) * darkness);
}

/** Clay that follows the theme while it lives: it joins the set the darkness walk repaints, and leaves on destroy */
class ClayMaterial extends Material3D {
  /** The colour on the light theme, which the dark one may brighten */
  private readonly _hex: number = 0;

  constructor(hex: number, options: ClayMaterialOptions) {
    super({
      baseColor: themed(hex),
      baseColorTexture: options.baseColorTexture,
      extraBits: options.extraBits,
      alphaMode: options.alphaMode,
      alpha: options.alpha,
      doubleSided: options.doubleSided,
      metallic: 0,
      roughness: 0.58,
      sheen: { color: sheenColor(), roughness: 0.42 },
      emissive: options.emissive,
    });
    this._hex = hex;
    live.add(this);
  }

  /** Writes the sheen and, for a colour that brightens in the dark, the base colour for the current darkness */
  public repaint(sheen: number): void {
    this.sheen!.color = sheen;
    if (DARK_COLORS.has(this._hex)) this.baseColor = themed(this._hex);
  }

  public override destroy(options?: Parameters<Material3D['destroy']>[0]): void {
    live.delete(this);
    super.destroy(options);
  }
}

/**
 * Clay in one colour, shared and cached per colour and look: its bit names, alpha mode, opacity and sides
 *
 * The kit owns these: don't destroy them yourself. Call {@link releaseClayMaterials} in your teardown, after
 * `view3d.unload()`.
 * @param color - A clay colour name, or any 0xRRGGBB.
 * @param options - How it draws: `extraBits`, `alphaMode` with `alpha` for see-through clay, `doubleSided`.
 */
export function clayMaterial(color: ClayColor | number, options: ClayLookOptions = {}): Material3D {
  const hex = typeof color === 'number' ? color : CLAY[color];
  const { extraBits, alphaMode = 'opaque', doubleSided = false } = options;
  const alpha = Math.round((options.alpha ?? 1) * 100) / 100;
  const bits = extraBits?.length ? extraBits.map((bit) => bit.name).join(',') : '';
  const key = `${hex}:${alphaMode}:${alpha}:${doubleSided ? 2 : 1}:${bits}`;
  let material = cache.get(key);

  if (!material) {
    material = new ClayMaterial(hex, { extraBits, alphaMode, alpha, doubleSided });
    cache.set(key, material);
  }

  return material;
}

/**
 * A clay material of your own, not shared: one per toy with its own painted texture, or one that glows
 *
 * A shared clay material is on every mesh of its colour and look, and glow controls exist only on a material built
 * with an `emissive` group, so this is how clay gets a texture of its own or a glow. It follows the theme like the
 * shared ones until you destroy it. The caller owns the result.
 * @example
 * ```ts
 * const lamp = createClayMaterial({ color: 'pink', emissive: { color: BRAND.hotPink, strength: 0 } });
 *
 * lamp.emissive.strength = 0.8; // a hit lights it
 * ```
 */
export function createClayMaterial(options: ClayMaterialOptions & { emissive: EmissiveOptions }): GlowingClayMaterial;
export function createClayMaterial(options?: ClayMaterialOptions): Material3D;
export function createClayMaterial(options: ClayMaterialOptions = {}): Material3D {
  const { color = 'white' } = options;

  return new ClayMaterial(typeof color === 'number' ? color : CLAY[color], options);
}

/**
 * Moves every live clay material between the light theme (0) and the dark one (1)
 *
 * `ThemeStage` calls it; call it yourself only when lighting a scene without one. A uniform write or two per
 * material, cheap enough to fade.
 */
export function setClayDarkness(t: number): void {
  if (t === darkness) return;
  darkness = t;

  const sheen = sheenColor();

  for (const material of live) material.repaint(sheen);
}

/**
 * Destroys every shared clay material, so the next {@link clayMaterial} call builds afresh, and stops the ones
 * {@link createClayMaterial} made from following the theme; those stay yours to destroy
 */
export function releaseClayMaterials(): void {
  for (const material of cache.values()) material.destroy();
  cache.clear();
  live.clear();
}
