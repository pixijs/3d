import { definedProps } from 'pixi.js';

import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from './EmitterShape';

/**
 * Options for {@link BoxShape}
 * @category extras:particles
 * @standard
 */
export interface BoxShapeOptions {
  /** Extent along x @default 1 */
  width?: number;
  /** Extent along y @default 1 */
  height?: number;
  /** Extent along z @default 1 */
  depth?: number;
}

/**
 * Spawns anywhere inside an axis-aligned box, heading up
 *
 * Good for rain, snow, dust motes and any volume you want filled evenly.
 * @category extras:particles
 * @standard
 */
export class BoxShape implements EmitterShape {
  /** Extent along x */
  public width: number;
  /** Extent along y */
  public height: number;
  /** Extent along z */
  public depth: number;

  /** Default {@link BoxShapeOptions} merged under every constructor call; mutate to change them process-wide */
  public static defaultOptions: BoxShapeOptions = { width: 1, height: 1, depth: 1 };

  constructor(options: BoxShapeOptions = {}) {
    const { width, height, depth } = { ...BoxShape.defaultOptions, ...definedProps(options) };

    this.width = width!;
    this.height = height!;
    this.depth = depth!;
  }

  /**
   * Draws a point anywhere in the box, heading up
   * @param rng - The system's random source
   * @param outPos - Receives the spawn offset, relative to the emitter
   * @param outDir - Receives the direction, always +Y
   */
  public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
    outPos.set((rng() - 0.5) * this.width, (rng() - 0.5) * this.height, (rng() - 0.5) * this.depth);
    outDir.set(0, 1, 0);
  }
}
