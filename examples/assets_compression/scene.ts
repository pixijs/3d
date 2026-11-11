/**
 * Where each model stands: the three geometry encodings in a row at the back, the two texture ones in front of the
 * gaps, where their maps show best
 */

import { Box, Container3D, Sphere } from '@pixi/3d';
import type { Model3D } from '@pixi/3d';

/** A model's place on the floor, the radius of the sphere it's scaled to fit, and its turn to face the camera */
export interface Slot {
  x: number;
  z: number;
  radius: number;
  yaw: number;
}

const bounds = new Box();
const sphere = new Sphere();

/**
 * Scales a model so the sphere round it has `slot.radius`, and stands it on the floor centred on a stand at the slot,
 * turned by `slot.yaw`. Returns the stand, which turns the model about its own middle.
 */
export function standModel(model: Model3D, slot: Slot, parent: Container3D): Container3D {
  const stand = new Container3D({ x: slot.x, z: slot.z, rotation: { x: 0, y: slot.yaw, z: 0 }, parent });
  const { center } = sphere.setFromBox(model.getLocalBounds(bounds));
  const scale = slot.radius / sphere.radius;

  model.scale = scale;
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  stand.addChild(model);

  return stand;
}
