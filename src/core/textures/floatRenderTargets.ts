import { RendererType } from 'pixi.js';
import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

/**
 * WebGL 2 draws into a float texture only with `EXT_color_buffer_float`; WebGPU always can
 * @internal
 */
export function assertFloatRenderable(renderer: WebGLRenderer | WebGPURenderer, what: string): void {
  if (renderer.type !== RendererType.WEBGL || (renderer as WebGLRenderer).context.extensions.colorBufferFloat) return;
  throw new Error(
    `${what}: this WebGL 2 device has no EXT_color_buffer_float, so it cannot draw into a float texture.`,
  );
}

/**
 * Picks `rg11b10ufloat`, which has no alpha, or `rgba16float` on a WebGPU device without
 * `rg11b10ufloat-renderable`; WebGL 2 needs what {@link assertFloatRenderable} checks
 * @internal
 */
export function floatRgbFormat(renderer: WebGLRenderer | WebGPURenderer): 'rg11b10ufloat' | 'rgba16float' {
  if (renderer.type !== RendererType.WEBGPU) return 'rg11b10ufloat';
  return (renderer as WebGPURenderer).gpu.device.features.has('rg11b10ufloat-renderable')
    ? 'rg11b10ufloat'
    : 'rgba16float';
}
