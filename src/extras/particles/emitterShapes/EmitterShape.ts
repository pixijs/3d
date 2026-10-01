import type { Vector3 } from '../../../math/vector/Vector3';

/**
 * Where a particle starts and which way it heads
 *
 * A shape is sampled once per particle, so it may allocate at construction but
 * never inside {@link EmitterShape.sample}. Positions are relative to the
 * emitter; the system moves them into world space when it needs to.
 * @example
 * ```ts
 * class MyRingShape implements EmitterShape {
 *   public radius = 2;
 *
 *   public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
 *     const angle = rng() * Math.PI * 2;
 *
 *     outPos.set(Math.cos(angle) * this.radius, 0, Math.sin(angle) * this.radius);
 *     outDir.set(0, 1, 0);
 *   }
 * }
 *
 * const halo = new ParticleSystem3D({ shape: new MyRingShape(), speed: 1 });
 * ```
 * @category extras:particles
 * @standard
 */
export interface EmitterShape {
  /**
   * Writes one spawn offset into `outPos` and a unit direction into `outDir`
   * @example
   * ```ts
   * const preview = new Vector3();
   * const heading = new Vector3();
   *
   * emitter.shape.sample(seededRandom('preview'), preview, heading);
   * ```
   * @param {() => number} rng - The system's random source; use it (not `Math.random`) so seeded runs stay reproducible.
   * @param {Vector3} outPos - Receives the spawn offset, emitter-relative.
   * @param {Vector3} outDir - Receives a unit direction.
   */
  sample(rng: () => number, outPos: Vector3, outDir: Vector3): void;
}
