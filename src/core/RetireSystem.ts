import { ExtensionType } from 'pixi.js';

/**
 * Destroys what it's handed at the start of the next render, when the render that may still draw from it has been
 * submitted. Renders never overlap, so one renderer's system can take what another renderer drew from
 * @internal
 */
export class RetireSystem {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGLSystem, ExtensionType.WebGPUSystem],
    name: 'retire3d',
  } as const;

  private readonly _retired: { destroy(): void }[] = [];

  public retire(resource: { destroy(): void }): void {
    this._retired.push(resource);
  }

  public prerender(): void {
    const retired = this._retired;
    for (let i = 0; i < retired.length; i++) retired[i].destroy();
    retired.length = 0;
  }

  public destroy(): void {
    this.prerender();
    (this._retired as { destroy(): void }[] | null) = null;
  }
}

declare global {
  namespace PixiMixins {
    interface WebGLSystems {
      /** Destroys replaced GPU resources at the start of the next render */
      retire3d: RetireSystem;
    }
    interface WebGPUSystems {
      /** Destroys replaced GPU resources at the start of the next render */
      retire3d: RetireSystem;
    }
  }
}
