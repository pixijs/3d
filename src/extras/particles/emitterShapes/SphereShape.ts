import { definedProps } from 'pixi.js';

import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from './EmitterShape';

/**
 * Options for {@link SphereShape}
 * @category extras:particles
 * @standard
 */
export interface SphereShapeOptions {
  /** Sphere radius. 0 gives a point source firing in every direction @default 1 */
  radius?: number;
  /** Spawn only on the surface instead of throughout the volume @default false */
  shell?: boolean;
}

/**
 * Spawns inside (or on) a sphere and heads radially outward
 *
 * Good for explosions, sparks and ambient motes.
 * @category extras:particles
 * @standard
 */
export class SphereShape implements EmitterShape {
  /** Sphere radius */
  public radius: number;
  /** Whether spawns land on the surface instead of through the volume */
  public shell: boolean;

  /** Default {@link SphereShapeOptions} merged under every constructor call; mutate to change them process-wide */
  public static defaultOptions: SphereShapeOptions = { radius: 1, shell: false };

  constructor(options: SphereShapeOptions = {}) {
    const { radius, shell } = { ...SphereShape.defaultOptions, ...definedProps(options) };

    this.radius = radius!;
    this.shell = shell!;
  }

  /**
   * Draws a point in (or on) the sphere, heading radially outward
   * @param rng - The system's random source
   * @param outPos - Receives the spawn offset, relative to the emitter
   * @param outDir - Receives a unit direction
   */
  public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
    sampleUnitVector(rng, outDir);

    // cbrt spreads samples evenly through the volume; without it they pile up
    // near the centre.
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
