/**
 * One `Mesh3D` per object, which is the scene-graph path: every object's transform is its own. `field`, `cpu cull`,
 * `materials`, `textures` and `geometries` are all this, over one grey material, many, or many textured ones.
 */

import { Mesh3D } from '@pixi/3d';
import type { FrameScene } from 'benchy';

import type { FieldScene } from './data/field.ts';
import { toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

/**
 * Builds the field on the stage. `simulate` spins the objects in the data, untimed; the update is one quaternion
 * write per mesh, read straight out of the array the spin was written into.
 */
export function meshPerObject({ view }: PixiStage, data: FieldScene): FrameScene {
  const geometries = data.geometries.map(toGeometry);
  const materials = data.materials.map(toMaterial);
  const meshes: Mesh3D[] = [];
  for (let i = 0; i < data.count; i++) {
    const geometry = geometries[data.geom[i] ?? 0];
    const material = materials[data.material[i] ?? 0];
    if (!geometry || !material) throw new Error(`field: object ${i} names a geometry or material that is not there`);
    const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
    mesh.position.set(data.position[i * 3] ?? 0, data.position[i * 3 + 1] ?? 0, data.position[i * 3 + 2] ?? 0);
    mesh.scale.set(data.scale[i] ?? 1);
    meshes.push(view.root.addChild(mesh));
  }
  const quat = data.quat;
  return {
    simulate(seconds) {
      data.update(seconds);
    },
    update() {
      let at = 0;
      for (const mesh of meshes) {
        mesh.quaternion.fromArray(quat, at);
        at += 4;
      }
    },
    destroy() {
      for (const geometry of geometries) geometry.destroy(true);
      for (const material of materials) material.destroy(true);
    },
  };
}
