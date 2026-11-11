import { DEG_TO_RAD, TextureSource, RenderTarget } from 'pixi.js';

import type { Matrix4 } from '../../../math/matrix/Matrix4';
import type { Light } from '../../../scene/lights/Light';
import type { SpotLight } from '../../../scene/lights/SpotLight';
import type { CameraData } from '../../CameraData';
import type { ShadowDataGpu } from '../../gpu/ShadowRenderPassGpu';
import { MAX_CASCADES } from './csmUtils';

const MAX_SHADOW_LIGHTS = 4;

/**
 * Shadow map resolution preset
 *
 * The width and height in texels of each shadow map: `'low'` 512, `'medium'` 1024, `'high'` 2048,
 * `'ultra'` 4096. Each map takes 4 MB of GPU memory at `'medium'`, and each step up takes four
 * times as much. Set per view through
 * {@link View3D#shadowQuality}.
 * @example
 * ```ts
 * const view = new View3D({ width: 800, height: 600, shadowQuality: 'high' });
 * ```
 * @category rendering
 * @standard
 */
export type ShadowQuality = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Shadow map size per side for each preset, which {@link ShadowQuality} lists
 * @internal
 */
export const SHADOW_QUALITY_SIZE: Record<ShadowQuality, number> = {
  low: 512,
  medium: 1024,
  high: 2048,
  ultra: 4096,
};

/**
 * How soft shadow edges are
 *
 * A wider filter softens the edges and costs more texture reads per shadowed pixel:
 * - `'hard'`: one read; the crispest, cheapest edge, and the friendliest to mobile.
 * - `'pcf'`: four reads; smooth edges at low cost. The default.
 * - `'pcf-high'`: nine reads; the widest, softest edge, for higher-end devices.
 *
 * On most GPUs each read blends four neighbouring texels, so even `'hard'` has a slightly soft
 * edge. Set per view through {@link View3D#shadowFilter}.
 * @example
 * ```ts
 * view3d.shadowFilter = 'pcf-high';
 * ```
 * @category rendering
 * @standard
 */
export type ShadowFilter = 'hard' | 'pcf' | 'pcf-high';

/**
 * One cascade of a light's shadow: its camera, and the fields `ShadowDataList.ts` packs into its `uShadowData` slot
 * @internal
 */
export interface CascadeSlot {
  cameraData: CameraData;
  bias: number;
  normalBias: number;
  mapSize: number;
  /**
   * The light's cascade count on cascade 0 of a light with more than one; `0` elsewhere, which the
   * shadow bits read as a plain shadow
   */
  cascadeCount: number;
  /** Where each cascade ends, on cascade 0 of a cascaded light, refilled in place; `null` elsewhere */
  splits: number[] | null;
  needsRender: boolean;
}

/**
 * Whether a light draws its shadow this frame; the WebGPU pass asks in both prepare and render, so
 * render finds the cull results prepare staged
 * @internal
 */
export function castsShadowThisFrame(light: Light): boolean {
  return !!(light.castShadow && light._gpuShadowData && light._worldVisible && light._shadowDataIndex >= 0);
}

/**
 * Frees a light's cascade camera buffers, which pixi's GC skips on WebGPU, and pools its cull results;
 * `Light._releaseShadowState` drops the data after, so no result goes back to the pool twice
 * @internal
 */
export function releaseShadowCascades(data: ShadowDataGpu): void {
  const cascades = data.cascades;
  if (cascades) {
    for (let i = 0; i < cascades.length; i++) cascades[i]?.cameraData.destroy();
  }

  data.cullResults?.release();
}

/**
 * Whether a cascade skips re-rendering this frame at its update rate
 * @param updateRate - The cascade's update rate: 1 every frame, N every Nth, 0 only on a refresh
 * @param frameCount - The shadow pass's frame counter
 * @param forceUpdate - Whether a refresh was requested
 * @internal
 */
export function cascadeRenderSkip(updateRate: number, frameCount: number, forceUpdate: boolean): boolean {
  return !forceUpdate && (updateRate === 0 || (updateRate > 1 && frameCount % updateRate !== 0));
}

/**
 * A cascade's update rate from `shadow.update`: `'manual'` is 0, and a missing array entry is 1
 * @internal
 */
export function updateRateFor(update: number | number[] | 'manual', cascadeIndex: number): number {
  if (update === 'manual') return 0;
  if (typeof update === 'number') return update;
  return update[cascadeIndex] ?? 1;
}

/** @internal */
export const MAX_SHADOW_SLOTS = MAX_SHADOW_LIGHTS * MAX_CASCADES;

/**
 * Cascade slots a light fills: its clamped cascade count, or 1 for a fixed box or a spot light
 * @internal
 */
export function cascadeCountFor(light: Light): number {
  if (light.type !== 'directional' || light.shadow.cascades === undefined) return 1;
  return Math.min(Math.max(light.shadow.cascades, 1), MAX_CASCADES);
}

/**
 * A shadow map render target; the caller destroys the depth texture, since destroying the target leaves it
 * @internal
 */
export function createShadowRenderTarget(quality: ShadowQuality, layers: number): RenderTarget {
  const size = SHADOW_QUALITY_SIZE[quality];

  const shadowMap = new TextureSource({
    width: size,
    height: size,
    format: 'depth32float',
    scaleMode: 'linear',
    viewDimension: '2d-array',
    autoGenerateMipmaps: false,
    arrayLayerCount: layers,
    compare: 'less',
  });

  return new RenderTarget({
    colorTextures: 0,
    depthStencilTexture: shadowMap,
  });
}

/**
 * A spot light's shadow view and projection: twice its cone angle wide, from 1 world unit to its
 * `range`, or 1000 without one (issue #473)
 * @internal
 */
export function updateSpotShadowMatrices(
  spotLight: SpotLight,
  inverseLightMatrix: Matrix4,
  lightProjectionMatrix: Matrix4,
  applyWebGPUZRangeFix: boolean,
): void {
  inverseLightMatrix.getInverse(spotLight.worldTransform);

  const range = spotLight.range || 1000;
  const near = 1;
  const far = range;

  lightProjectionMatrix.makePerspective(spotLight.coneAngle * 2 * DEG_TO_RAD, 1, near, far);

  if (applyWebGPUZRangeFix) {
    const te = lightProjectionMatrix.elements;
    te[10] = far / (near - far);
    te[14] = (far * near) / (near - far);
  }
}
