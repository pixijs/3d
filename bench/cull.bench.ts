/**
 * `cpu cull`: frustum culling on the CPU, in a frame. The `field` scene, with the camera turned so a set share of
 * the meshes is in view. The view culls on the CPU (`cull: 'cpu'`), so every frame tests each mesh's bounds against
 * the view's planes and compacts the survivors inside the render. Judged on `cpu.render`, where all of it runs.
 *
 * The variants sweep what the cull's cost depends on:
 * - `spin*`: every mesh spins, so every bound has moved since the last frame; half the field in view.
 * - `still*`: nothing moves, so the bounds are the last frame's; half in view.
 * - `orbit20k`: nothing moves but the camera, which sweeps from a quarter to three quarters of the field in view.
 * - `most20k` and `few20k`: every mesh spins, with all the field in view, or about an eighth of it.
 *
 * `culling off` is the field spinning in a view that doesn't cull, which pays for keeping bounds it never reads.
 *
 * `default small` is 250 spinning meshes in a view left on its default, `'gpu'`: on WebGPU nothing reads the
 * bounds, on WebGL the pass culls on the CPU and keeps them.
 *
 * `batched cull` is the field as one `BatchedMesh3D` that culls on the CPU, its container swaying so the planes
 * move into its frame every frame. `still20k` leaves the slots alone, `spin20k` rewrites every slot's matrix every
 * frame through `matrices`, and `spinoff20k` does that with the batch's culling off. Judged on `cpu.frame`: a slot's
 * matrix write is the update's.
 */

import { BatchedMesh3D, Matrix4, Quaternion, RenderPassBit, Vector3 } from '@pixi/3d';
import type { CullMode } from '@pixi/3d';
import { frame } from 'benchy';

import { fieldScene } from './data/field.ts';
import type { FieldScene } from './data/field.ts';
import { FIELD_CAMERA, SCENE_ASPECT } from './data/look.ts';
import { meshPerObject } from './meshes.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** Half the horizontal angle the field fills from the camera, in radians. */
const FIELD_HALF_ANGLE = Math.atan(Math.tan((FIELD_CAMERA.fovY * Math.PI) / 360) * SCENE_ASPECT);

/**
 * Points the camera `turn` field half-angles to the right of the field's centre: 0 is the whole field in view, 1
 * puts the view's left edge on the centre line, about half the field, and 1.8 leaves about an eighth.
 */
function turnCamera({ view }: PixiStage, turn: number): void {
  const distance = FIELD_CAMERA.position[2];
  view.camera.lookAt({ x: distance * Math.tan(turn * FIELD_HALF_ANGLE), y: 0, z: 0 });
}

frame('cpu cull', {
  variants: {
    spin20k: { count: 20_000, spin: true, turn: 1, orbit: false },
    spin1k: { count: 1_000, spin: true, turn: 1, orbit: false },
    spin5k: { count: 5_000, spin: true, turn: 1, orbit: false },
    spin50k: { count: 50_000, spin: true, turn: 1, orbit: false },
    still1k: { count: 1_000, spin: false, turn: 1, orbit: false },
    still5k: { count: 5_000, spin: false, turn: 1, orbit: false },
    still20k: { count: 20_000, spin: false, turn: 1, orbit: false },
    still50k: { count: 50_000, spin: false, turn: 1, orbit: false },
    orbit20k: { count: 20_000, spin: false, turn: 1, orbit: true },
    most20k: { count: 20_000, spin: true, turn: 0, orbit: false },
    few20k: { count: 20_000, spin: true, turn: 1.8, orbit: false },
  },
  primary: 'cpu.render',
  gate: 'strict',
  options: { cull: 'cpu' },
  create(stage: PixiStage, { count, spin, turn, orbit }) {
    const data = fieldScene(count);
    applyLook(stage, data.look);
    turnCamera(stage, turn);
    const scene = meshPerObject(stage, data, !spin);
    if (!orbit) return scene;
    let sweep = turn;
    return {
      simulate(seconds) {
        scene.simulate?.(seconds);
        sweep = turn + 0.5 * Math.sin(seconds * Math.PI * 0.5);
      },
      update(dt) {
        scene.update?.(dt);
        turnCamera(stage, sweep);
      },
      destroy() {
        scene.destroy?.();
      },
    };
  },
});

frame('culling off', {
  variants: { spin20k: { count: 20_000 }, spin50k: { count: 50_000 } },
  primary: 'cpu.render',
  options: { cull: 'off' },
  create(stage: PixiStage, { count }) {
    const data = fieldScene(count);
    applyLook(stage, data.look);
    turnCamera(stage, 1);
    return meshPerObject(stage, data);
  },
});

frame('default small', {
  variants: { spin250: { count: 250 } },
  primary: 'cpu.render',
  create(stage: PixiStage, { count }) {
    const data = fieldScene(count);
    applyLook(stage, data.look);
    return meshPerObject(stage, data);
  },
});

/** Composes every object's matrix from the field data into the batch's own store. */
function composeSlots(data: FieldScene, batch: BatchedMesh3D): void {
  const { matrices } = batch;
  const target = matrices.data;
  const { offset, stride } = matrices;
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const matrix = new Matrix4();
  for (let i = 0; i < data.count; i++) {
    position.set(data.position[i * 3] ?? 0, data.position[i * 3 + 1] ?? 0, data.position[i * 3 + 2] ?? 0);
    rotation.fromArray(data.quat, i * 4);
    const s = data.scale[i] ?? 1;
    scale.set(s, s, s);
    matrix.compose(position, rotation, scale);
    target.set(matrix.elements, offset + i * stride);
  }
}

frame('batched cull', {
  variants: {
    still20k: { count: 20_000, spin: false, cull: 'cpu' },
    spin20k: { count: 20_000, spin: true, cull: 'cpu' },
    spinoff20k: { count: 20_000, spin: true, cull: 'off' },
  },
  primary: 'cpu.frame',
  create(stage: PixiStage, { count, spin, cull }) {
    const data = fieldScene(count);
    applyLook(stage, data.look);
    turnCamera(stage, 1);
    const geometries = data.geometries.map(toGeometry);
    const material = toMaterial(data.materials[0]!);
    const batch = new BatchedMesh3D({ size: count, cull: cull as CullMode });
    for (let i = 0; i < count; i++) {
      batch.setGeometryAt(i, geometries[data.geom[i] ?? 0]!);
      batch.setMaterialAt(i, material);
      batch.setPassesAt(i, RenderPassBit.OPAQUE);
    }
    stage.view.root.addChild(batch);
    composeSlots(data, batch);
    batch.matrices.update();
    let sway = 0;
    return {
      simulate(seconds) {
        sway = 0.1 * Math.sin(seconds * Math.PI * 0.5);
        if (!spin) return;
        data.update(seconds);
        composeSlots(data, batch);
      },
      update() {
        batch.rotation.y = sway;
        if (spin) batch.matrices.update();
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy(true);
        material.destroy();
      },
    };
  },
});
