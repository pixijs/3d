import { DEG_TO_RAD, Texture, TextureSource, RenderTarget } from 'pixi.js';

import type { Matrix4 } from '../../../math/matrix/Matrix4';
import type { Light, ShadowData } from '../../../scene/lights/Light';
import type { SpotLight } from '../../../scene/lights/SpotLight';
import type { CameraData } from '../../CameraData';
import type { CullResults } from '../CullResult';
import { MAX_CASCADES } from './csmUtils';

/**
 * Maximum number of shadow-casting lights supported
 * @internal
 */
export const MAX_SHADOW_LIGHTS = 4;

/**
 * Shadow map resolution preset
 *
 * The width and height in texels of each shadow map: `'low'` 512, `'medium'` 1024, `'high'` 2048,
 * `'ultra'` 4096. Each step up takes four times the GPU memory. Set per view through
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
 * Shadow map size in texels (per side) for each {@link ShadowQuality} preset
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
 * Picks the percentage-closer filtering (PCF) kernel a receiver's shader samples the shadow map
 * with. A wider kernel softens the edges and costs more texture reads per shadowed pixel:
 * - `'hard'`: one read; the crispest, cheapest edge, and the friendliest to mobile.
 * - `'pcf'`: four reads; smooth edges at low cost. The default.
 * - `'pcf-high'`: nine reads; the widest, softest edge, for higher-end devices.
 *
 * The shadow map's sampler filters linearly, so on most GPUs each read already blends four
 * neighbouring comparisons and even `'hard'` has a slightly soft edge. WebGPU and WebGL both let
 * a GPU skip that blend. Set per view through {@link View3D#shadowFilter}.
 * @example
 * ```ts
 * view3d.shadowFilter = 'pcf-high';
 * ```
 * @category rendering
 * @standard
 */
export type ShadowFilter = 'hard' | 'pcf' | 'pcf-high';

/**
 * One cascade of a light's shadow, the same on both backends
 *
 * A camera, made of the light-space view and an ortho or perspective box, plus what the
 * `uShadowData` uniform packs for it. WebGPU keeps its per-light cull results on the light's
 * `ShadowData`, not here.
 * @internal
 */
export interface CascadeSlot {
  /**
   * Where this cascade draws from, bound at group 1 by its draws
   *
   * Written by `ShadowRenderPassBase._commitCascadeCamera` whenever the cascade is re-fitted; a
   * cascade throttled off this frame keeps the last fit's matrices and cull volume together.
   */
  cameraData: CameraData;
  /** Shadow bias for depth comparison */
  bias: number;
  /** Normal-direction bias to reduce self-shadowing */
  normalBias: number;
  /** Shadow map resolution (texels per side) */
  mapSize: number;
  /**
   * The light's cascade count, on cascade 0 of a light with more than one; `0` everywhere else
   *
   * A spot light, a fixed box and a lone cascade all keep `0`, which the shader reads as a plain
   * shadow.
   */
  cascadeCount: number;
  /**
   * Distances from the camera where each cascade ends, on cascade 0 of a cascaded light; `null`
   * everywhere else
   *
   * Cascade 0 keeps the array and refills it in place each fit, so a frame allocates nothing.
   */
  splits: number[] | null;
  /**
   * Whether this cascade's depth layer should be re-rendered this frame
   *
   * `false` when a temporal update rate (or manual mode) skips it.
   */
  needsRender: boolean;
}

/**
 * Whether a light contributes shadow draws this frame
 *
 * True when it casts, has its GPU shadow data, is visible, and fit the shadow-atlas budget
 * (`_shadowDataIndex >= 0`). The WebGPU shadow pass tests it in both prepare and render, so
 * render finds the cull results prepare staged; the WebGL pass tests it in render.
 * @param light - The light to test
 * @internal
 */
export function castsShadowThisFrame(light: Light): boolean {
  return !!(light.castShadow && light._gpuShadowData && light._worldVisible && light._shadowDataIndex >= 0);
}

/**
 * Releases the per-cascade camera data and the cull results held on a light's shadow data
 *
 * On WebGPU a cascade's camera uniform buffer is exempt from the renderer GC, since recorded
 * cascade bundles replay it without fetching it again, so only `CameraData.destroy` here ever
 * frees it. The cull results, a WebGPU-only field reached structurally, go back to the global
 * `BigPool`, which frees their GPU buffers and keeps their CPU arrays for the next light.
 *
 * `Light._releaseShadowState` calls it when the light leaves a view, when the view unloads, and on
 * destroy, and then sets `_gpuShadowData` to `null`, so the light can never hand back a result it
 * has already returned.
 * @param data - The light's shadow data
 * @internal
 */
export function releaseShadowCascades(data: ShadowData): void {
  const cascades = data.cascades;
  if (cascades) {
    for (let i = 0; i < cascades.length; i++) cascades[i]?.cameraData.destroy();
  }

  (data as ShadowData & { cullResults?: CullResults }).cullResults?.release();
}

/**
 * Decides whether a cascade skips re-rendering this frame under its resolved update rate
 *
 * `1` (default) renders every frame, `N` every Nth frame, `0` only when
 * {@link Light#refreshShadows} forces it. A skipped cascade keeps its frozen matrix and depth
 * layer.
 * @param updateRate - The cascade's resolved update rate
 * @param frameCount - The shadow pass's running frame counter
 * @param forceUpdate - Whether a refresh was requested, which overrides the rate
 * @internal
 */
export function cascadeRenderSkip(updateRate: number, frameCount: number, forceUpdate: boolean): boolean {
  return !forceUpdate && (updateRate === 0 || (updateRate > 1 && frameCount % updateRate !== 0));
}

/**
 * Resolves the per-cascade update rate from a light's {@link LightShadow#update}
 *
 * `'manual'` → `0` (refresh only), a scalar applies to every cascade, an array is indexed per
 * cascade (missing entries default to `1`).
 * @param update - The light's `shadow.update` setting
 * @param cascadeIndex - The cascade to resolve the rate for
 * @internal
 */
export function updateRateFor(update: number | number[] | 'manual', cascadeIndex: number): number {
  if (update === 'manual') return 0;
  if (typeof update === 'number') return update;
  return update[cascadeIndex] ?? 1;
}

/**
 * Total shadow-map layers available: `MAX_SHADOW_LIGHTS` lights × `MAX_CASCADES` cascades
 * @internal
 */
export const MAX_SHADOW_SLOTS = MAX_SHADOW_LIGHTS * MAX_CASCADES;

/**
 * Number of cascade slots a light fills and renders
 *
 * The configured cascade count (clamped to `1..MAX_CASCADES`) for a cascaded directional light,
 * `1` for a fixed-box directional, and `1` for spot lights. The shadow passes, slot claiming and
 * the packed light list all read it, so allocation, upload and selection agree.
 * @param light - The light to count cascade slots for
 * @internal
 */
export function cascadeCountFor(light: Light): number {
  if (light.type !== 'directional' || light.shadow.cascades === undefined) return 1;
  return Math.min(Math.max(light.shadow.cascades, 1), MAX_CASCADES);
}

/**
 * Creates a shadow map render target for the given quality level
 *
 * The depth texture filters linearly through a comparison sampler, so most GPUs blend the four
 * comparisons around each shader read; see {@link ShadowFilter}.
 * @param quality - The quality tier that sets the map's size
 * @param layers - Texture-array layer count
 * @returns A {@link RenderTarget} with a depth32float 2D-array texture.
 * @internal
 */
export function createShadowRenderTarget(quality: ShadowQuality, layers: number): RenderTarget {
  const size = SHADOW_QUALITY_SIZE[quality];

  const shadowMap = new Texture(
    new TextureSource({
      width: size,
      height: size,
      format: 'depth32float',
      scaleMode: 'linear',
      viewDimension: '2d-array',
      autoGenerateMipmaps: false,
      arrayLayerCount: layers,
    }),
  );

  shadowMap.source.style.compare = 'less';

  return new RenderTarget({
    colorTextures: 0,
    depthStencilTexture: shadowMap,
  });
}

/**
 * Computes the single-map perspective shadow view and projection for a spot light
 *
 * The field of view is twice `coneAngle`, the near plane is fixed at 1 world unit, and the far
 * plane is `range`, or 1000 when the light has none; issue #473 covers where that breaks. Directional
 * lights use the fixed-box (`computeFixedBoxMatrix`) or cascade (`computeCascadeMatrix`) paths and
 * never reach here. The caller pairs the two matrices into a camera and forms the view-projection
 * there.
 * @param spotLight - The spot light.
 * @param inverseLightMatrix - Receives the inverse light world transform — the spot's view.
 * @param lightProjectionMatrix - Receives the light projection.
 * @param applyWebGPUZRangeFix - If true, remaps Z to [0,1] range (WebGPU). If false, keeps [-1,1] (WebGL).
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
