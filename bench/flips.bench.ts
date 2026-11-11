/**
 * `flips`: hiding and showing slots of an unculled batch. One `BatchedMesh3D` with culling off (its default),
 * standing still, a sixth of its slots hidden at any moment; every frame `births` slots go out and as many come in
 * through `setVisibleAt`, so every frame recompacts the batch's survivors. The variants are batch sizes, either side
 * of the size where that compaction moves from the CPU walk to the GPU (`GPU_VISIBILITY_MIN`).
 *
 * Judged on `cpu.render`, where the compaction runs; `update` walks every slot to find the flips.
 */

import { BatchedMesh3D, RenderPassBit } from '@pixi/3d';
import { frame } from 'benchy';

import { instancedChurnScene } from './data/field.ts';
import { rng } from './data/rng.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** Share of the slots out at any moment. */
const OUT_SHARE = 1 / 6;

type Knobs = { slots: number; births: number };

/** Object `i`'s rotation, uniform scale and position as a column-major matrix at `o` in `out`. */
function writeTrs(out: Float32Array, o: number, i: number, p: Float32Array, s: Float32Array, q: Float32Array): void {
  const x = q[i * 4] ?? 0;
  const y = q[i * 4 + 1] ?? 0;
  const z = q[i * 4 + 2] ?? 0;
  const w = q[i * 4 + 3] ?? 1;
  const sc = s[i] ?? 1;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out.set(
    [
      (1 - (yy + zz)) * sc,
      (xy + wz) * sc,
      (xz - wy) * sc,
      0,
      (xy - wz) * sc,
      (1 - (xx + zz)) * sc,
      (yz + wx) * sc,
      0,
      (xz + wy) * sc,
      (yz - wx) * sc,
      (1 - (xx + yy)) * sc,
      0,
      p[i * 3] ?? 0,
      p[i * 3 + 1] ?? 0,
      p[i * 3 + 2] ?? 0,
      1,
    ],
    o,
  );
}

function flipScene(stage: PixiStage, { slots, births }: Knobs) {
  const data = instancedChurnScene(slots);
  applyLook(stage, data.look);
  const geometries = data.geometries.map(toGeometry);
  const materials = data.materials.map(toMaterial);
  const count = data.count;
  const batch = new BatchedMesh3D({ size: count });
  for (let i = 0; i < count; i++) {
    const geometry = geometries[data.geom[i] ?? 0];
    const material = materials[data.material[i] ?? 0];
    if (!geometry || !material) throw new Error(`flips: slot ${i} names a geometry or material that is not there`);
    batch.setGeometryAt(i, geometry);
    batch.setMaterialAt(i, material);
    batch.setPassesAt(i, RenderPassBit.OPAQUE);
  }
  const { data: matrixData, stride, offset } = batch.matrices;
  for (let i = 0; i < count; i++) writeTrs(matrixData, offset + i * stride, i, data.position, data.scale, data.quat);
  batch.matrices.update();
  stage.view.root.addChild(batch);

  const place = new Int32Array(count);
  const shuffle = rng(2500);
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = shuffle.int(i + 1);
    const swap = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = swap;
  }
  order.forEach((slot, at) => (place[slot] = at));

  const isOut = (slot: number, frameIndex: number): boolean =>
    ((((place[slot] ?? 0) - frameIndex * births) % count) + count) % count < count * OUT_SHARE;
  const shownNow = new Uint8Array(count).fill(1);
  for (let i = 0; i < count; i++) {
    if (!isOut(i, 0)) continue;
    batch.setVisibleAt(i, false);
    shownNow[i] = 0;
  }

  let frameIndex = 0;
  return {
    simulate(seconds: number) {
      frameIndex = Math.round(seconds * 60);
    },
    update() {
      for (let i = 0; i < count; i++) {
        const wanted = isOut(i, frameIndex) ? 0 : 1;
        if (shownNow[i] === wanted) continue;
        batch.setVisibleAt(i, wanted === 1);
        shownNow[i] = wanted;
      }
    },
    destroy() {
      for (const geometry of geometries) geometry.destroy(true);
      for (const material of materials) material.destroy(true);
    },
  };
}

frame('flips', {
  variants: {
    s1k: { slots: 1000, births: 10 },
    s4k: { slots: 4000, births: 10 },
    s12k: { slots: 12_000, births: 10 },
    s24k: { slots: 24_000, births: 10 },
    's24k-n100': { slots: 24_000, births: 100 },
    s50k: { slots: 50_000, births: 10 },
  },
  primary: 'cpu.render',
  gate: 'strict',
  create(stage: PixiStage, knobs: Knobs) {
    return flipScene(stage, knobs);
  },
});
