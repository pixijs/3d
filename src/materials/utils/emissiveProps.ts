import type { ColorSource, Texture } from 'pixi.js';

import { createFeaturePropsClass } from './createFeaturePropsClass';

/**
 * Emissive surface glow (core glTF emissive + KHR_materials_emissive_strength)
 * @category materials
 * @standard
 */
export interface EmissiveOptions {
  /**
   * Emissive colour multiplier
   *
   * Defaults to white when the group is present — presence signals intent, so texture-only
   * emissive renders as-authored.
   * @default 0xffffff
   */
  color?: ColorSource;
  /**
   * KHR_materials_emissive_strength multiplier — lifts the 0–1 clamp for HDR/bloom
   * @default 1
   */
  strength?: number;
  /** Emissive map */
  texture?: Texture;
}

/**
 * Runtime emissive props
 *
 * Present iff the material was constructed with an `emissive` group.
 * @category materials
 * @standard
 */
export interface EmissiveProps {
  /**
   * Emissive colour multiplier
   *
   * `Container.tint` semantics: set any {@link ColorSource}, read back the canonical hex number.
   */
  get color(): number;
  /** Accepts any {@link ColorSource}; stored back as the canonical hex number */
  set color(value: ColorSource);
  /** KHR_materials_emissive_strength multiplier — lifts the 0–1 clamp for HDR/bloom */
  strength: number;
  /** Emissive map */
  texture: Texture;
}

/**
 * Generated props class binding the emissive group to the packed material data
 *
 * Shared by every material that composes `emissiveBit` (Material3D, PhongMaterial): the bit fixes
 * the struct field names (`emissive` / `emissiveStrength`) and the texture slot (`emissive`), so
 * one binding schema serves them all.
 * @internal
 */
export const EmissivePropsClass = createFeaturePropsClass<EmissiveProps>({
  color: { kind: 'colour', field: 'emissive' },
  strength: { kind: 'scalar', field: 'emissiveStrength' },
  texture: { kind: 'texture', slot: 'emissive' },
});
