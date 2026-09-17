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
  /** Half-angle of the spray, in degrees, measured from +Y @default 25 */
  angle?: number;
  /** Radius of the disc particles spawn on @default 0 */
  radius?: number;
}

/**
 * Spawns on a disc in the XZ plane and heads up within `angle` degrees of +Y
 *
 * The workhorse for fire, smoke plumes, exhaust and sprays.
 * @category extras:particles
 * @standard
 */
export class ConeShape implements EmitterShape {
  /** Half-angle of the spray, in degrees */
  public angle: number;
  /** Radius of the spawn disc */
  public radius: number;

  /** Default {@link ConeShapeOptions} merged under every constructor call; mutate to change them process-wide */
  public static defaultOptions: ConeShapeOptions = { angle: 25, radius: 0 };

  constructor(options: ConeShapeOptions = {}) {
    const { angle, radius } = { ...ConeShape.defaultOptions, ...definedProps(options) };

    this.angle = angle!;
    this.radius = radius!;
  }

  /**
   * Draws a point on the spawn disc, heading up within the cone
   * @param rng - The system's random source
   * @param outPos - Receives the spawn offset, relative to the emitter
   * @param outDir - Receives a unit direction
   */
  public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
    const discAngle = rng() * Math.PI * 2;
    // sqrt keeps the disc evenly covered rather than centre-heavy.
    const discRadius = this.radius * Math.sqrt(rng());

    outPos.set(Math.cos(discAngle) * discRadius, 0, Math.sin(discAngle) * discRadius);

    // Uniform over the spherical cap: cos(theta) interpolates from 1 (straight
    // up) to cos(angle) at the cone's edge.
    const cosTheta = 1 - rng() * (1 - Math.cos(this.angle * DEG_TO_RAD));
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = rng() * Math.PI * 2;

    outDir.set(Math.cos(phi) * sinTheta, cosTheta, Math.sin(phi) * sinTheta);
  }
}
