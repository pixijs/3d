import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from './EmitterShape';

/**
 * All particles start at the emitter and head straight up
 *
 * The default shape. Combine it with `speed` for a jet, or leave `speed` at 0
 * and let gravity or a custom behaviour do the work.
 * @category extras:particles
 * @standard
 */
export class PointShape implements EmitterShape {
  /**
   * Puts the particle on the emitter, heading straight up
   * @param _rng - Unused; every particle starts at the same point
   * @param outPos - Receives the spawn offset, always the origin
   * @param outDir - Receives the direction, always +Y
   */
  public sample(_rng: () => number, outPos: Vector3, outDir: Vector3): void {
    outPos.set(0, 0, 0);
    outDir.set(0, 1, 0);
  }
}
