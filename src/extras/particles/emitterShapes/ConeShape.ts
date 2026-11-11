import { definedProps, DEG_TO_RAD } from 'pixi.js';

import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from './EmitterShape';

/**
 * Options for {@link ConeShape}
 * @example
 * ```ts
 * new ConeShape({ angle: 15, radius: 0.2 });
 * ```
 * @category extras:particles
 * @standard
 */
export interface ConeShapeOptions {
  /**
   * Half-angle of the spray, in degrees, measured from +Y
   * @default 25
   * @example
   * ```ts
   * const narrow = new ConeShape({ angle: 5 });
   * ```
   */
  angle?: number;
  /**
   * Radius of the disc particles spawn on
   * @default 0
   * @example
   * ```ts
   * const burner = new ConeShape({ angle: 10, radius: 0.5 });
   * ```
   */
  radius?: number;
}

/**
 * Spawns on a disc in the XZ plane and heads up within `angle` degrees of +Y
 *
 * The workhorse for fire, smoke plumes, exhaust and sprays.
 * @example
 * ```ts
 * const plume = new ParticleSystem3D({ shape: new ConeShape({ angle: 12, radius: 0.3 }), speed: 2 });
 * ```
 * @category extras:particles
 * @standard
 */
export class ConeShape implements EmitterShape {
  /**
   * Half-angle of the spray, in degrees
   * @example
   * ```ts
   * nozzle.angle = 40;
   * ```
   */
  public angle = 0;
  /**
   * Radius of the spawn disc
   * @example
   * ```ts
   * nozzle.radius = 0.1;
   * ```
   */
  public radius = 0;

  /**
   * Defaults for every new `ConeShape`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * ConeShape.defaultOptions.angle = 15;
   * ```
   */
  public static defaultOptions: ConeShapeOptions = { angle: 25, radius: 0 };

  constructor(options: ConeShapeOptions = {}) {
    const { angle, radius } = { ...ConeShape.defaultOptions, ...definedProps(options) };

    this.angle = angle!;
    this.radius = radius!;
  }

  /**
   * Draws a point on the spawn disc, heading up within the cone; both spread evenly
   * @example
   * ```ts
   * class MyTwinJetShape implements EmitterShape {
   *   private readonly _cone = new ConeShape({ angle: 10 });
   *
   *   public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
   *     this._cone.sample(rng, outPos, outDir);
   *     if (rng() < 0.5) outDir.y = -outDir.y;
   *   }
   * }
   * ```
   * @param rng - The system's random source
   * @param outPos - Receives the spawn offset, relative to the emitter
   * @param outDir - Receives a unit direction
   * @advanced
   */
  public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
    const discAngle = rng() * Math.PI * 2;
    const discRadius = this.radius * Math.sqrt(rng());

    outPos.set(Math.cos(discAngle) * discRadius, 0, Math.sin(discAngle) * discRadius);

    const cosTheta = 1 - rng() * (1 - Math.cos(this.angle * DEG_TO_RAD));
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = rng() * Math.PI * 2;

    outDir.set(Math.cos(phi) * sinTheta, cosTheta, Math.sin(phi) * sinTheta);
  }
}
