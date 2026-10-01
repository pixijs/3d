import { DEG_TO_RAD } from 'pixi.js';

import { Box } from '../../math/shapes/Box';
import { Sphere } from '../../math/shapes/Sphere';
import type { Camera3D } from '../cameras/Camera3D';
import type { Container3D } from '../Container3D';

const _bounds = new Box();
const _sphere = new Sphere();

/**
 * Parks a perspective camera on the +Z side of `target`, facing it, at the closest distance where
 * the sphere around the target's local bounds fits the viewport; near and far follow the distance
 *
 * The camera keeps its rotation, so this expects a fresh camera facing local -Z. An empty or
 * single-point target is framed as if its sphere had a radius of 1.
 * @param camera - Camera to place; its `fov` and `zoom` set the fit.
 * @param target - Subtree to frame, measured with `getLocalBounds`.
 * @param aspect - Viewport width over height.
 * @internal
 */
export function frameCamera(camera: Camera3D, target: Container3D, aspect: number): void {
  const { center, radius } = _sphere.setFromBox(target.getLocalBounds(_bounds));

  const fit = radius > 0 ? radius : 1;
  const halfFovY = ((camera.fov / camera.zoom) * DEG_TO_RAD) / 2;
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  const distance = fit / Math.sin(Math.min(halfFovX, halfFovY));

  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.position.set(center.x, center.y, center.z + distance);
}
