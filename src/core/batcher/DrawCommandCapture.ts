import type { Buffer, Geometry, TextureSource } from 'pixi.js';

/** @internal */
export type CapturedResource = Buffer | TextureSource;

/** @internal */
export class DrawCommandCapture {
  /** The `captureTick` of the build that last recorded the resource, or -1 when no build has */
  public generation = 0;
  public tailOwners = 0;
  /** Geometries whose GPU layouts bake the buffer, dropped when it's lost; `null` marks a texture source */
  public readonly geometries: Geometry[] | null;

  constructor(
    public readonly resource: CapturedResource,
    generation: number,
    geometry: Geometry | null,
  ) {
    this.generation = generation;
    this.geometries = geometry ? [geometry] : null;
  }
}
