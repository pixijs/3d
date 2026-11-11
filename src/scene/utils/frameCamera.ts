import { Box } from '../../math/shapes/Box';
import { Sphere } from '../../math/shapes/Sphere';
import type { Camera3D } from '../cameras/Camera3D';
import type { Container3D } from '../Container3D';

const _bounds = new Box();
const _sphere = new Sphere();

/**
 * Moves a perspective camera onto the +Z side of `target` without turning it, so it must still face local -Z
 * @internal
 */
export function frameCamera(camera: Camera3D, target: Container3D, aspect: number): void {
  const { center, radius } = _sphere.setFromBox(target.getLocalBounds(_bounds));

  const fit = radius > 0 ? radius : 1;
  const tanHalfFovY = camera._tanHalfFovY();
  const halfFovY = Math.atan(tanHalfFovY);
  const halfFovX = Math.atan(tanHalfFovY * aspect);
  const distance = fit / Math.sin(Math.min(halfFovX, halfFovY));

  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.position.set(center.x, center.y, center.z + distance);
}
