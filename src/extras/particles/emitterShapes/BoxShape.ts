import { definedProps } from 'pixi.js';

import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from './EmitterShape';

/**
 * Options for {@link BoxShape}
 * @example
 * ```ts
 * const options: BoxShapeOptions = { width: 20, height: 0, depth: 20 };
 * const sky = new BoxShape(options);
 * ```
 * @category extras:particles
 * @standard
 */
export interface BoxShapeOptions {
  /**
   * Size along x
   * @default 1
   * @example
   * ```ts
   * const wall = new BoxShape({ width: 8, height: 4, depth: 0.1 });
   * ```
   */
  width?: number;
  /**
   * Size along y
   * @default 1
   * @example
   * ```ts
   * const column = new BoxShape({ width: 0.5, height: 6, depth: 0.5 });
   * ```
   */
  height?: number;
  /**
   * Size along z
   * @default 1
   * @example
   * ```ts
   * const lane = new BoxShape({ width: 1, height: 0, depth: 30 });
   * ```
   */
  depth?: number;
}

/**
 * Spawns anywhere inside a box centred on the emitter and aligned with its axes, heading up
 *
 * Good for rain, snow, dust motes and any volume you want filled evenly.
 * @example
 * ```ts
 * const snow = new ParticleSystem3D({
 *   shape: new BoxShape({ width: 20, height: 0, depth: 20 }),
 *   gravity: 0.5,
 *   life: 8,
 * });
 *
 * snow.position.y = 10;
 * ```
 * @category extras:particles
 * @standard
 */
export class BoxShape implements EmitterShape {
  /**
   * Size along x
   * @example
   * ```ts
   * rainArea.width = arenaWidth;
   * ```
   */
  public width = 0;
  /**
   * Size along y
   * @example
   * ```ts
   * rainArea.height = 0;
   * ```
   */
  public height = 0;
  /**
   * Size along z
   * @example
   * ```ts
   * rainArea.depth = 40;
   * ```
   */
  public depth = 0;

  /**
   * Defaults for every new `BoxShape`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * BoxShape.defaultOptions.height = 0;
   * ```
   */
  public static defaultOptions: BoxShapeOptions = { width: 1, height: 1, depth: 1 };

  constructor(options: BoxShapeOptions = {}) {
    const { width, height, depth } = { ...BoxShape.defaultOptions, ...definedProps(options) };

    this.width = width!;
    this.height = height!;
    this.depth = depth!;
  }

  /**
   * Draws a point anywhere in the box, heading up
   * @example
   * ```ts
   * class MyRainShape implements EmitterShape {
   *   private readonly _box = new BoxShape({ width: 20, height: 0, depth: 20 });
   *
   *   public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
   *     this._box.sample(rng, outPos, outDir);
   *     outDir.set(0, -1, 0);
   *   }
   * }
   * ```
   * @param rng - The system's random source
   * @param outPos - Receives the spawn offset, relative to the emitter
   * @param outDir - Receives +Y
   * @advanced
   */
  public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
    outPos.set((rng() - 0.5) * this.width, (rng() - 0.5) * this.height, (rng() - 0.5) * this.depth);
    outDir.set(0, 1, 0);
  }
}
