import { ExtensionType } from 'pixi.js';

const retired: { destroy(): void }[] = [];

/**
 * Destroys `resource` at the start of the next render, when the render that may still draw from it has been
 * submitted. Renders never overlap, so one list serves every renderer
 * @internal
 */
export function retire(resource: { destroy(): void }): void {
  retired.push(resource);
}

/**
 * Empties the `retire` list at the start of each render and when its renderer is destroyed
 * @internal
 */
export class RetireSystem {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGLSystem, ExtensionType.WebGPUSystem],
    name: 'retire3d',
  } as const;

  public prerender(): void {
    for (let i = 0; i < retired.length; i++) retired[i].destroy();
    retired.length = 0;
  }

  public destroy(): void {
    this.prerender();
  }
}
