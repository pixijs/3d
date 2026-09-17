/**
 * Number of dynamic texture slots a batch texture bind group carries
 *
 * Materials within one draw batch share these slots; overflow finalises the
 * current bind group and starts a new one. Reserved textures
 * (EMPTY / WHITE / NORMAL_MAP) map to fixed shader slots 13–15 and never
 * consume one.
 *
 * Intentionally conservative: WebGPU texture limits are per-stage *across all
 * bind groups*, and the global group already binds environment + BRDF LUT
 * (+ shadows).
 * @internal
 */
export const MAX_BATCH_TEXTURES = 10;
