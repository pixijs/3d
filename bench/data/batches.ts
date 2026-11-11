/** The batches scene: many separate batches, each a small block of boxes on a node of its own that spins. */

import { box } from './geometry.ts';
import type { Geometry } from './geometry.ts';
import { coverageScale, FIELD_CAMERA, fieldLook, hsvToLinear, scatterInFrustum, spinner } from './look.ts';
import type { PbrSpec, SceneLook } from './look.ts';
import { rng } from './rng.ts';

/** Boxes along each edge of a batch's block. */
const EDGE = 2;

/** Boxes in a batch: the block is `EDGE` cubed. */
export const SLOTS = EDGE * EDGE * EDGE;

/** Many batches, each drawn with its own world matrix. */
export interface BatchesScene {
  look: SceneLook;
  geometry: Geometry;
  /** Four materials; the last two carry a map pair, so the batches don't all share one shader. */
  materials: PbrSpec[];
  count: number;
  /** Index into `materials`, per batch: every box of a batch has its batch's material. */
  material: Uint16Array;
  /** `count × 3`: where each batch's node sits. */
  position: Float32Array;
  /** `SLOTS × 16`: the boxes' matrices inside a batch, column-major, the same block in every batch. */
  slots: Float32Array;
  /** `count × 4` quaternions of the batches' nodes, rewritten by `update`. */
  quat: Float32Array;
  /** Spins the batches' nodes to `t` seconds. */
  update(seconds: number): void;
}

/** `count` batches of `SLOTS` boxes scattered through the frustum, every batch's node spinning. */
export function batchesScene(count: number): BatchesScene {
  const random = rng(4000 + count);
  const scale = coverageScale(count * SLOTS, 2000, 0.05, 1);
  const materials: PbrSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const spec: PbrSpec = {
      color: hsvToLinear(random.next(), random.range(0.4, 0.9), random.range(0.5, 0.95)),
      roughness: random.range(0.2, 0.9),
      metalness: 0,
    };
    if (i >= 2) spec.texture = i;
    materials.push(spec);
  }
  const material = new Uint16Array(count);
  for (let i = 0; i < count; i++) material[i] = i % materials.length;

  const slots = new Float32Array(SLOTS * 16);
  for (let i = 0; i < SLOTS; i++) {
    const at = i * 16;
    slots[at] = scale;
    slots[at + 5] = scale;
    slots[at + 10] = scale;
    slots[at + 12] = ((i % EDGE) - 0.5) * scale * 1.5;
    slots[at + 13] = ((Math.floor(i / EDGE) % EDGE) - 0.5) * scale * 1.5;
    slots[at + 14] = (Math.floor(i / (EDGE * EDGE)) - 0.5) * scale * 1.5;
    slots[at + 15] = 1;
  }

  const quat = new Float32Array(count * 4);
  const spin = spinner(random, count);
  spin(0, quat);
  return {
    look: fieldLook(),
    geometry: box(),
    materials,
    count,
    material,
    position: scatterInFrustum(random, FIELD_CAMERA, count, 25, 55, scale * 3),
    slots,
    quat,
    update(seconds) {
      spin(seconds, quat);
    },
  };
}
