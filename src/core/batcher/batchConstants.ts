/**
 * Number of texture slots in a batch texture bind group
 *
 * Materials drawn in one batch share these slots. When the next material's textures don't fit, the
 * batcher finalises the current bind group and starts a new one. `Texture.EMPTY`, `Texture.WHITE`
 * and the default normal map never take a slot: they pack as slots 13 to 15, which the shader turns
 * into constant colours without sampling.
 *
 * Ten is what the global bind group leaves. WebGPU guarantees 16 sampled textures per shader stage
 * across every bind group of a pipeline (`maxSampledTexturesPerShaderStage`), and the global group
 * binds six: the environment, the BRDF lookup, the shadow map, the opaque depth and colour copies,
 * and the material store.
 * @internal
 */
export const MAX_BATCH_TEXTURES = 10;
