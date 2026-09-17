/**
 * URLs the Draco worker loads the decoder from, defaulting to Google's hosted build
 *
 * Mirrors Pixi's Basis Universal `setBasisTranscoderPath` pattern. Users that prefer to
 * self-host can call {@link setDracoDecoderPath} with their own paths before loading any
 * Draco-compressed glTF assets.
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
 * Call before loading any Draco-compressed glTF assets.
 * @param config - Replacement decoder JS/WASM URLs; omitted fields keep their current value
 * @category assets
 * @advanced
 */
export function setDracoDecoderPath(config: Partial<typeof dracoDecoderUrls>): void {
  Object.assign(dracoDecoderUrls, config);
}
