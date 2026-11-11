import { Application } from 'pixi.js';

import type { RenderType } from '../types';

/**
 * Makes every `Application.init` use the renderer picked in the playground
 *
 * Site examples ask for `preference: 'webgpu'` and never import the playground, so the WebGL and
 * WebGPU toggle reaches them by overriding what they pass.
 * @param renderer - The renderer the playground's toggle picked
 */
export function forcePreference(renderer: RenderType): void {
  // oxlint-disable-next-line typescript/unbound-method -- called below with the instance as `this`
  const init = Application.prototype.init;

  Application.prototype.init = function (options) {
    return init.call(this, { ...options, preference: renderer });
  };
}
