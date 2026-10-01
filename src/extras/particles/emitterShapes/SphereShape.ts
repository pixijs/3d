import { definedProps } from 'pixi.js';

import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from './EmitterShape';

/**
 * Options for {@link SphereShape}
 * @example
 * ```ts
 * const options: SphereShapeOptions = { radius: 0.5, shell: true };
 * const blast = new SphereShape(options);
 * ```
 * @category extras:particles
 * @standard
 */
export interface SphereShapeOptions {
  /**
   * Sphere radius. 0 gives a point source firing in every direction
   * @default 1
   * @example
   * ```ts
   * const pop = new SphereShape({ radius: 0 });
   * ```
   */
  radius?: number;
  /**
   * Spawn only on the surface instead of throughout the volume
   * @default false
   * @example
   * ```ts
   * const bubble = new SphereShape({ radius: 2, shell: true });
   * ```
   */
  shell?: boolean;
}

/**
 * Spawns inside (or on) a sphere and heads radially outward
 *
 * Good for explosions, sparks and ambient motes.
 * @example
 * ```ts
 * const explosion = new ParticleSystem3D({ shape: new SphereShape({ radius: 0.2 }), speed: [4, 8] });
 * ```
 * @category extras:particles
 * @standard
 */
export class SphereShape implements EmitterShape {
  /**
   * Sphere radius
   * @example
   * ```ts
   * shockwave.radius += growth * dt;
   * ```
   */
  public radius = 0;
  /**
   * Whether spawns land on the surface instead of through the volume
   * @example
   * ```ts
   * aura.shell = true;
   * ```
   */
  public shell: boolean;

  /**
   * Default {@link SphereShapeOptions} merged under every constructor call; mutate to change them process-wide
   * @example
   * ```ts
   * SphereShape.defaultOptions.radius = 0.5;
   * ```
   */
  public static defaultOptions: SphereShapeOptions = { radius: 1, shell: false };

  constructor(options: SphereShapeOptions = {}) {
    const { radius, shell } = { ...SphereShape.defaultOptions, ...definedProps(options) };

    this.radius = radius!;
    this.shell = shell!;
  }

  /**
   * Draws a point in (or on) the sphere, heading radially outward
   *
   * Through the volume, the radius takes the cube root of its draw, which spreads points evenly
   * rather than piling them up near the centre.
   * @example
   * ```ts
   * class MyDomeShape implements EmitterShape {
   *   private readonly _sphere = new SphereShape({ radius: 3, shell: true });
   *
   *   public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
   *     this._sphere.sample(rng, outPos, outDir);
   *     outPos.y = Math.abs(outPos.y);
   *     outDir.y = Math.abs(outDir.y);
   *   }
   * }
   * ```
   * @param rng - The system's random source
   * @param outPos - Receives the spawn offset, relative to the emitter
   * @param outDir - Receives a unit direction
   * @advanced
   */
  public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
    sampleUnitVector(rng, outDir);

    const r = this.shell ? this.radius : this.radius * Math.cbrt(rng());

    outPos.set(outDir.x * r, outDir.y * r, outDir.z * r);
  }
}

/**
 * Writes a uniformly distributed point on the unit sphere into `out`
 * @param rng - The system's random source
 * @param out - Receives the unit vector
 */
function sampleUnitVector(rng: () => number, out: Vector3): void {
  const y = rng() * 2 - 1;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = rng() * Math.PI * 2;

  out.set(Math.cos(phi) * ring, y, Math.sin(phi) * ring);
}
