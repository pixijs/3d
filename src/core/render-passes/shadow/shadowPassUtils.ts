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
 * Selects the per-side texel size of each shadow map layer: `'low'` 512, `'medium'` 1024,
 * `'high'` 2048, `'ultra'` 4096. Set per view via {@link View3D#shadowQuality}.
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
 * Shadow edge-filtering quality
 *
 * Selects the percentage-closer-filter (PCF) kernel compiled into a receiver's shadow sampler —
 * a wider kernel softens shadow edges at the cost of more texture taps per shadowed fragment.
 * Each tap is a hardware 2×2 bilinear PCF fetch (the shadow map uses a linear comparison
 * sampler), so even a single tap is smooth:
 * - `'hard'` — one tap; the crispest, cheapest edge. Mobile-friendliest.
 * - `'pcf'` — four taps; smooth edges at low cost. The default.
 * - `'pcf-high'` — nine taps; the widest, softest penumbra, for higher-end devices.
 *
 * Set per view via {@link View3D#shadowFilter}; it governs the kernel for every shadow that
 * view samples.
 * @category rendering
 * @standard
 */
export type ShadowFilter = 'hard' | 'pcf' | 'pcf-high';

/**
 * Per-cascade shadow state shared by both backends
 *
 * A cascade is a camera — light-space view, ortho or perspective box — plus the metadata packed
 * into the `uShadowData` uniform. Identical on both backends; WebGPU hangs its per-light cull
 * results off the light's `ShadowData` rather than the slot.
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
  /** Number of cascades for this light (meaningful only on cascade 0; 0 otherwise) */
  cascadeCount: number;
  /** View-space split depths (set only on cascade 0; null otherwise) */
  splits: number[] | null;
  /**
   * Whether this cascade's depth layer should be re-rendered this frame
   * `false` when a temporal update rate (or manual mode) skips it.
   */
  needsRender: boolean;
}

/**
 * Whether a light contributes shadow draws this frame
 *
 * True when it casts, has its GPU shadow data, is visible, and fit the shadow-atlas budget
 * (`_shadowDataIndex >= 0`). The shadow passes' prepare and render walk the light list with this
 * same test, so per-light state built in one phase is found in the other.
 * @param light - The light to test
 * @internal
 */
export function castsShadowThisFrame(light: Light): boolean {
  return !!(light.castShadow && light._gpuShadowData && light._worldVisible && light._shadowDataIndex >= 0);
}

/**
 * Releases the per-cascade camera-data bind groups and the cull results held on a light's shadow data
 *
 * Each cull result owns a survivor + indirect-args GPU buffer, recycled to the global `BigPool`.
 * A cascade's camera group is exempt from the renderer GC (recorded cascade bundles reference its
 * buffer, so it must stay resident for its whole life), which means nothing else ever reclaims it —
 * `CameraData.destroy` does. Called when a light is destroyed or detaches from a view — callers
 * null `_gpuShadowData` right after, so this light can never hand back a result it has recycled.
 * @param data - The light's shadow data
 * @internal
 */
export function releaseShadowCascades(data: ShadowData): void {
  const cascades = data.cascades;
  if (cascades) {
    for (let i = 0; i < cascades.length; i++) cascades[i]?.cameraData.destroy();
  }

  // WebGPU-only field, reached structurally. The results are recycled to the global BigPool, not
  // destroyed — a later light reclaims their GPU buffers instead of reallocating.
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
 * `1` for a fixed-box directional, and `1` for spot lights. The single source of truth shared by
 * the shadow passes, both lighting systems, and the packed light list's cascade count, so
 * allocation, upload, and selection always agree.
 * @param light - The light to count cascade slots for
 * @internal
 */
export function cascadeCountFor(light: Light): number {
  if (light.type !== 'directional' || light.shadow.cascades === undefined) return 1;
  return Math.min(Math.max(light.shadow.cascades, 1), MAX_CASCADES);
}

/**
 * Creates a shadow map render target for the given quality level
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
      // Linear filtering on the comparison sampler (`compare` set below) gives
      // hardware 2×2 bilinear PCF: one fetch depth-tests 4 texels and returns the
      // interpolated coverage, so each shader tap is already a smooth 2×2 kernel.
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
 * Directional lights use the fixed-box (`computeFixedBoxMatrix`) or cascade
 * (`computeCascadeMatrix`) paths and never reach here. The caller pairs the two matrices into a
 * camera and forms the view-projection there.
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
