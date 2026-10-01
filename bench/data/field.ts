/**
 * The field scenes: many separate meshes, each with its own transform (`field`, `materials`, `textures`,
 * `geometries`, and the lit field `post` draws effects over), and one batch of instances whose matrices are
 * rewritten every frame (`instances`).
 */

import { box, fieldGeometries, geometryVariants } from './geometry.ts';
import type { Geometry } from './geometry.ts';
import {
  coverageScale,
  FIELD_CAMERA,
  fieldLook,
  greyMaterial,
  hsvToLinear,
  scatterInFrustum,
  spinner,
} from './look.ts';
import type { PbrSpec, SceneLook } from './look.ts';
import { rng } from './rng.ts';
import type { Rng } from './rng.ts';

/** Many separate meshes, each with its own transform: the scene-graph and batching workload. */
export interface FieldScene {
  look: SceneLook;
  geometries: Geometry[];
  materials: PbrSpec[];
  count: number;
  /** Index into `geometries`, per object. */
  geom: Uint16Array;
  /** Index into `materials`, per object. */
  material: Uint16Array;
  position: Float32Array;
  scale: Float32Array;
  /** `count × 4` quaternions, rewritten by `update`. */
  quat: Float32Array;
  /** Spins the objects to `t` seconds. */
  update(seconds: number): void;
}

/**
 * Where an instances scene writes its matrices: column-major 4×4s, slot `i`'s sixteen floats starting at
 * `offset + i * stride` in `data`. The floats between one slot's matrix and the next are left alone, so a batch's
 * own store, with its per-slot data in them, can be the target.
 */
export interface MatrixTarget {
  readonly data: Float32Array;
  readonly offset: number;
  readonly stride: number;
}

/** One batch of instances, whose matrices are rewritten every frame. */
export interface InstancesScene {
  look: SceneLook;
  geometry: Geometry;
  material: PbrSpec;
  /**
   * Composes every matrix at `t` seconds into `target`. The target is read once a call, so a batch that
   * replaces its store between frames is followed.
   */
  update(seconds: number, target: MatrixTarget): void;
}

/**
 * `count` unique animated meshes of eight geometry types, scattered through the frustum. Every
 * object spins, so every object's transform is rewritten every frame: this is the scene-graph and
 * batching workload, not a fill-rate one.
 */
export function fieldScene(
  count: number,
  materials: PbrSpec[] = [greyMaterial()],
  seed = 1,
  geometries = fieldGeometries(),
): FieldScene {
  const random = rng(seed);
  const scale = coverageScale(count);
  const geom = new Uint16Array(count);
  const material = new Uint16Array(count);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    geom[i] = random.int(geometries.length);
    material[i] = materials.length > 1 ? random.int(materials.length) : 0;
    scales[i] = scale * random.range(0.8, 1.2);
  }
  const position = scatterInFrustum(random, FIELD_CAMERA, count, 25, 55, scale);
  const quat = new Float32Array(count * 4);
  const spin = spinner(random, count);
  spin(0, quat);
  return {
    look: fieldLook(),
    geometries,
    materials,
    count,
    geom,
    material,
    position,
    scale: scales,
    quat,
    update(seconds) {
      spin(seconds, quat);
    },
  };
}

/** The field at a fixed 20 000 objects over `materials` distinct materials. */
export function materialsScene(materials: number): FieldScene {
  const random = rng(2000 + materials);
  const palette: PbrSpec[] = [];
  for (let i = 0; i < materials; i++) {
    palette.push({
      color: hsvToLinear(random.next(), random.range(0.4, 0.9), random.range(0.5, 0.95)),
      roughness: random.range(0.2, 0.9),
      metalness: random.next() < 0.3 ? 0.6 : 0,
    });
  }
  return fieldScene(20_000, palette, 2);
}

/** `count` white materials, each with its own map pair, seeded by its index, and a roughness from `random`. */
function texturedPalette(random: Rng, count: number): PbrSpec[] {
  const palette: PbrSpec[] = [];
  for (let i = 0; i < count; i++) {
    palette.push({ color: [1, 1, 1], roughness: random.range(0.3, 0.8), metalness: 0, texture: i });
  }
  return palette;
}

/** The field at 5000 objects over `materials` textured materials, each with a base-colour and a normal map. */
export function texturesScene(materials: number): FieldScene {
  return fieldScene(5000, texturedPalette(rng(2100 + materials), materials), 2);
}

/** The textures field at 32 materials, spread over `geometries` distinct geometries rather than eight. */
export function geometriesScene(geometries: number): FieldScene {
  return fieldScene(5000, texturedPalette(rng(2200 + geometries), 32), 2, geometryVariants(geometries));
}

/**
 * One batch of `count` instances whose matrices are rewritten every frame. The matrices are composed here,
 * outside the timed part of the frame, straight into whatever target the bench names, so what the engine is asked
 * for is only what it does with them.
 */
export function instancesScene(count: number, seed = 3): InstancesScene {
  const random = rng(seed);
  const scale = coverageScale(count, 2000, 0.03, 2);
  const position = scatterInFrustum(random, FIELD_CAMERA, count, 25, 55, scale);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) scales[i] = scale * random.range(0.8, 1.2);
  const quat = new Float32Array(count * 4);
  const spin = spinner(random, count);
  const update = (seconds: number, target: MatrixTarget): void => {
    const { data: matrices, offset, stride } = target;
    spin(seconds, quat);
    for (let i = 0; i < count; i++) {
      const x = quat[i * 4] ?? 0;
      const y = quat[i * 4 + 1] ?? 0;
      const z = quat[i * 4 + 2] ?? 0;
      const w = quat[i * 4 + 3] ?? 0;
      const s = scales[i] ?? 1;
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
      const at = offset + i * stride;
      matrices[at] = (1 - (yy + zz)) * s;
      matrices[at + 1] = (xy + wz) * s;
      matrices[at + 2] = (xz - wy) * s;
      matrices[at + 3] = 0;
      matrices[at + 4] = (xy - wz) * s;
      matrices[at + 5] = (1 - (xx + zz)) * s;
      matrices[at + 6] = (yz + wx) * s;
      matrices[at + 7] = 0;
      matrices[at + 8] = (xz + wy) * s;
      matrices[at + 9] = (yz - wx) * s;
      matrices[at + 10] = (1 - (xx + yy)) * s;
      matrices[at + 11] = 0;
      matrices[at + 12] = position[i * 3] ?? 0;
      matrices[at + 13] = position[i * 3 + 1] ?? 0;
      matrices[at + 14] = position[i * 3 + 2] ?? 0;
      matrices[at + 15] = 1;
    }
  };
  return {
    look: fieldLook(),
    geometry: box(),
    material: greyMaterial(),
    update,
  };
}
