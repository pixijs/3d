import type { RenderType } from './types';

const params = new URLSearchParams(location.search);

/**
 * Reads the `?renderer=webgl|webgpu` URL parameter set by the playground UI.
 * Defaults to `'webgpu'` when no parameter is present.
 */
export const rendererPreference: RenderType = (params.get('renderer') as RenderType) ?? 'webgpu';
