/**
 * `transparency`: 10 000 see-through meshes in a ball over an opaque floor, standing still while the camera circles
 * them, over eight low-poly shapes and eight colours with a perforated texture. The variants are the surfaces:
 * `blend` is every mesh alpha-blended (`alphaMode: 'blend'`), which routes it to the transparent pass and its
 * back-to-front sort, redone every frame because the camera moved; `cutout` is every mesh alpha-tested (`'mask'`),
 * which writes depth, needs no order and draws in the opaque pass after the opaque meshes; `mixed` is every other
 * mesh each. The scene is otherwise one scene: the same shapes, places, sizes and colours in every variant.
 *
 * Judged on `cpu.render`: the sort, and the draw list rebuilt in the sorted order, happen inside the render, and the
 * cutouts show what the same objects cost without them. The sorted order is also what breaks the batch: neighbours
 * in depth rarely share a shape and a colour, so the blended frame breaks into far more draws than the cutout frame.
 *
 * The view culls on the CPU (`cull: 'cpu'`): a GPU cull compacts a draw's survivors in whatever order its threads
 * finish, so the cutout frame would differ from run to run. The blended pass culls on the CPU under `'gpu'` as well,
 * to keep its back-to-front order.
 *
 * The count is the question's setting rather than a rung: change `COUNT` to ask what the order costs at another.
 * The objects shrink as the count grows so the screen stays about as covered and the blended layers about as deep.
 */

import { Material3D, Mesh3D } from '@pixi/3d';
import { frame } from 'benchy';
import type { Texture } from 'pixi.js';

import type { Vec3 } from './data/look.ts';
import { transparencyScene } from './data/transparency.ts';
import type { AlphaMaterialSpec, AlphaMix } from './data/transparency.ts';
import { applyLook, displayColor, toGeometry, toMaterial, toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** The objects in the ball: the count the question is asked at. */
const COUNT = 10_000;

/** The `Material3D` options a see-through surface sets, beyond the untextured opaque ones. */
interface AlphaMaterialOptions {
  baseColor: Vec3;
  roughness: number;
  metallic: number;
  baseColorTexture: Texture;
  alpha: number;
  alphaMode: 'blend' | 'mask';
  alphaCutoff: number;
}

function alphaMaterial(spec: AlphaMaterialSpec, texture: Texture, alphaCutoff: number): Material3D {
  const options: AlphaMaterialOptions = {
    baseColor: displayColor(spec.color),
    roughness: spec.roughness,
    metallic: spec.metalness,
    baseColorTexture: texture,
    alpha: spec.opacity,
    alphaMode: spec.alpha === 'blend' ? 'blend' : 'mask',
    alphaCutoff,
  };
  return new Material3D(options);
}

frame('transparency', {
  variants: { blend: { alpha: 'blend' }, cutout: { alpha: 'cutout' }, mixed: { alpha: 'mixed' } },
  primary: 'cpu.render',
  gate: 'strict',
  options: { cull: 'cpu' },
  create(stage: PixiStage, { alpha }: { alpha: AlphaMix }) {
    const data = transparencyScene(COUNT, alpha);
    applyLook(stage, data.look);
    const { view } = stage;
    const texture = toTexture(data.texture, 'transparency-holes');
    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map((spec) => alphaMaterial(spec, texture, data.alphaCutoff));
    const { floor } = data;
    const floorGeometry = toGeometry(floor.geometry);
    const floorMaterial = toMaterial(floor.material);
    const slab = new Mesh3D({
      geometry: floorGeometry,
      material: floorMaterial,
      castShadow: false,
      receiveShadow: false,
    });
    slab.position.set(...floor.position);
    slab.scale.set(...floor.scale);
    view.root.addChild(slab);
    for (let i = 0; i < data.count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material) {
        throw new Error(`transparency: object ${i} names a geometry or material that is not there`);
      }
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      view.root.addChild(mesh);
    }
    // The data moves the camera in place, so the update reads its position where the circle left it.
    const eye = data.look.camera.position;
    const [x, y, z] = data.look.camera.target;
    const target = { x, y, z };
    return {
      simulate(seconds) {
        data.update(seconds);
      },
      update() {
        view.camera.position.set(eye[0], eye[1], eye[2]);
        view.camera.lookAt(target);
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy();
        floorGeometry.destroy(true);
        floorMaterial.destroy();
        texture.destroy(true);
      },
    };
  },
});
