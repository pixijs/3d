import type { ColorSource, Texture } from 'pixi.js';

import { createFeaturePropsClass } from './createFeaturePropsClass';

/**
 * Options for a material's own glow, the `emissive` group of {@link Material3D} and
 * {@link PhongMaterial}
 *
 * Passing the group turns the glow on. It is added after lighting, so it shows in the dark. Follows
 * glTF's emissive colour and texture plus `KHR_materials_emissive_strength`.
 * @example
 * ```ts
 * const lamp = new Material3D({ emissive: { color: 0xffcc66, strength: 3 } });
 * ```
 * @category materials
 * @standard
 */
export interface EmissiveOptions {
  /**
   * Glow colour, multiplied by `texture` when there is one
   *
   * White when the group is passed without it, so a texture-only glow shows as authored.
   * @default 0xffffff
   * @example
   * ```ts
   * const ember = new Material3D({ emissive: { color: 'orange' } });
   * ```
   */
  color?: ColorSource;
  /**
   * Multiplier on the glow; above 1 it goes past white, which bloom picks up
   * @default 1
   * @example
   * ```ts
   * const neon = new Material3D({ emissive: { color: 0x66ccff, strength: 8 } });
   * ```
   */
  strength?: number;
  /**
   * Glow map, multiplied by `color`
   * @example
   * ```ts
   * const tower = new Material3D({ emissive: { texture: litWindowsTexture } });
   * ```
   */
  texture?: Texture;
}

/**
 * Runtime controls for a material's glow, as `material.emissive`
 *
 * Present only when the material was built with an `emissive` group. Changes never recompile the
 * shader.
 * @example
 * ```ts
 * const sign = new Material3D({ emissive: { color: 0xff0044 } });
 * sign.emissive!.strength = 2;
 * ```
 * @category materials
 * @standard
 */
export interface EmissiveProps {
  /**
   * Glow colour; takes any `ColorSource` and reads back a hex number, like `Container.tint`
   * @example
   * ```ts
   * material.emissive!.color = 'red';
   * ```
   */
  get color(): number;
  /** Sets the glow colour from any `ColorSource` */
  set color(value: ColorSource);
  /**
   * Multiplier on the glow; above 1 it goes past white, which bloom picks up
   * @example
   * ```ts
   * material.emissive!.strength = 4;
   * ```
   */
  strength: number;
  /**
   * Glow map, multiplied by `color`
   * @example
   * ```ts
   * material.emissive!.texture = await Assets.load('lit-windows.png');
   * ```
   */
  texture: Texture;
}

/**
 * The props class behind `material.emissive`
 *
 * Shared by every material that composes `emissiveBit` (Material3D, PhongMaterial): the bit fixes
 * the field names (`emissive`, `emissiveStrength`) and the slot name (`emissive`).
 * @internal
 */
export const EmissivePropsClass = createFeaturePropsClass<EmissiveProps>({
  color: { kind: 'colour', field: 'emissive' },
  strength: { kind: 'scalar', field: 'emissiveStrength' },
  texture: { kind: 'texture', slot: 'emissive' },
});
