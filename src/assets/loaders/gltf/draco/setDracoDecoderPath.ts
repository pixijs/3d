/**
 * The URLs the Draco decoder loads from, by default Google's hosted build;
 * {@link setDracoDecoderPath} changes them
 * @category assets
 * @advanced
 */
export const dracoDecoderUrls = {
  jsUrl: 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js',
  wasmUrl: 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm',
};

/**
 * Sets where the Draco decoder is fetched from, to self-host it
 *
 * Call it before loading the first Draco-compressed file, as the decoder loads once, on the first
 * decode. A relative URL resolves against the page's origin, not the page's path.
 * @example
 * ```ts
 * setDracoDecoderPath({
 *   jsUrl: '/draco/draco_wasm_wrapper.js',
 *   wasmUrl: '/draco/draco_decoder.wasm',
 * });
 * ```
 * @param config - Decoder JS and WASM URLs; a field left out keeps its current value
 * @category assets
 * @standard
 */
export function setDracoDecoderPath(config: Partial<typeof dracoDecoderUrls>): void {
  Object.assign(dracoDecoderUrls, config);
}
