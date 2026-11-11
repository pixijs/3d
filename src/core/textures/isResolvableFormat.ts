import { RendererType } from 'pixi.js';
import type { TEXTURE_FORMATS, WebGLRenderer, WebGPURenderer } from 'pixi.js';

/** Integer and 32-bit float formats stay out: neither backend resolves integers, and WebGPU can't resolve 32-bit floats */
const RESOLVABLE_FORMATS: ReadonlySet<TEXTURE_FORMATS> = new Set<TEXTURE_FORMATS>([
  'r8unorm',
  'rg8unorm',
  'rgba8unorm',
  'rgba8unorm-srgb',
  'bgra8unorm',
  'rgb10a2unorm',
  'r16float',
  'rg16float',
  'rgba16float',
  'rg11b10ufloat',
]);

/**
 * `rgba8unorm` is out on WebGL: pixi gives it the unsized internal format `RGBA`, which a multisampled
 * renderbuffer rejects, so its target draws nothing
 * @internal
 */
export function isResolvableFormat(renderer: WebGLRenderer | WebGPURenderer, format: TEXTURE_FORMATS): boolean {
  if (format === 'rgba8unorm' && renderer.type === RendererType.WEBGL) return false;
  return RESOLVABLE_FORMATS.has(format);
}
