import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from './EmitterShape';

/**
 * Starts every particle at the emitter, heading straight up; the default shape
 * @example
 * ```ts
 * const jet = new ParticleSystem3D({ shape: new PointShape(), speed: 6 });
 * ```
 * @category extras:particles
 * @standard
 */
export class PointShape implements EmitterShape {
  /**
   * Puts the particle on the emitter, heading straight up
   * @example
   * ```ts
   * class MyFountainShape implements EmitterShape {
   *   private readonly _point = new PointShape();
   *
   *   public sample(rng: () => number, outPos: Vector3, outDir: Vector3): void {
   *     this._point.sample(rng, outPos, outDir);
   *     outPos.y = 1.2;
   *   }
   * }
   * ```
   * @param _rng - Unused
   * @param outPos - Receives the origin
   * @param outDir - Receives +Y
   * @advanced
   */
  public sample(_rng: () => number, outPos: Vector3, outDir: Vector3): void {
    outPos.set(0, 0, 0);
    outDir.set(0, 1, 0);
  }
}
