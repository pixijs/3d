import type { Vector3 } from '../../../math/vector/Vector3';

/**
 * Where a particle starts and which way it heads
 *
 * Shapes are sampled once per spawn, so they may allocate at construction but
 * never inside {@link EmitterShape.sample}. Positions are relative to the
 * emitter; the system moves them into world space when it needs to.
 * @category extras:particles
 * @standard
 */
export interface EmitterShape {
  /**
   * Writes one spawn offset into `outPos` and a unit direction into `outDir`
   * @param {() => number} rng - The system's random source; use it (not `Math.random`) so seeded runs stay reproducible.
   * @param {Vector3} outPos - Receives the spawn offset, emitter-relative.
   * @param {Vector3} outDir - Receives a unit direction.
   */
  sample(rng: () => number, outPos: Vector3, outDir: Vector3): void;
}
