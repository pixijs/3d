/**
 * URLs the Draco worker loads the decoder from, defaulting to Google's hosted build
 *
 * Change them with {@link setDracoDecoderPath}.
 * @category assets
 * @advanced
 */
export const dracoDecoderUrls = {
  jsUrl: 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js',
  wasmUrl: 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm',
};

/**
 * Overrides where the Draco decoder is fetched from, for self-hosted deployments
 *
 * Works like pixi's `setBasisTranscoderPath`. Call it before loading the first Draco-compressed
 * file: the decoder loads once, on that first decode. A relative URL resolves against the page's
 * origin, not the page's path.
 * @example
 * ```ts
 * setDracoDecoderPath({
 *   jsUrl: '/draco/draco_wasm_wrapper.js',
 *   wasmUrl: '/draco/draco_decoder.wasm',
 * });
 * ```
 * @param config - Replacement decoder JS/WASM URLs; omitted fields keep their current value
 * @category assets
 * @standard
 */
export function setDracoDecoderPath(config: Partial<typeof dracoDecoderUrls>): void {
  Object.assign(dracoDecoderUrls, config);
}
