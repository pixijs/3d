/**
 * Most lights a view draws at once
 *
 * Ambient lights don't count. Past the limit, the visible lights last in {@link View3D#lights}
 * are left out. It can't exceed 32, the bits of the light mask in `LightTiles.ts`.
 * @category scene
 * @advanced
 */
export const MAX_LIGHTS = 32;

/**
 * Floats per light slot in `LightDataList`: four `vec4`s, as the `MAX_LIGHTS * 4` size of `uLightData` assumes
 * @internal
 */
export const FLOATS_PER_LIGHT = 16;
