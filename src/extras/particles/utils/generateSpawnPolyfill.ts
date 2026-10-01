import type { PointData3D } from '../../../math/vector/PointData3D';
import type { PointData4D } from '../../../math/vector/PointData4D';
import { unorm16, unorm8 } from '../../../scene/particles/utils/packUnorm';
import { sampleSpread } from '../particleSpread';
import {
  ABSENT,
  AS_F32,
  AS_FRAME,
  AS_PACKED,
  AS_TINT,
  AS_UNORM8,
  CONSTANT,
  FROM_CLOCK,
  FROM_SPREAD,
  FROM_VELOCITY,
  PAIR,
} from './spawnPlan';
import type { SpawnAttribute, SpawnFn, SpawnShape } from './spawnPlan';

const VERTS = 4;

/**
 * `lo + (hi - lo) · r`, the exact expression the generated code inlines
 * @param lo - Value at `r = 0`
 * @param hi - Value at `r = 1`
 * @param r - Blend factor, 0..1
 * @returns The interpolated value.
 */
function lerp(lo: number, hi: number, r: number): number {
  return lo + (hi - lo) * r;
}
/** `SPREAD.speed` in the system's spread table; the one spread no attribute owns */
const SPEED_OFFSET = 2;

/**
 * The interpreted twin of `generateSpawn`, for pages that forbid `new Function`
 *
 * Same arguments, same contract, same bytes: each particle is assembled as one
 * vertex row, the shape's position then every attribute in list order, and the
 * row is stamped across the quad as 32-bit words, so packed attributes copy
 * bit-exact. The loop reads the attribute list's numbers from a flat table,
 * five ints per attribute (element index, components, source, store and
 * spread), and switches on them per particle, which is the ~30 ns a particle
 * the generated function gets back.
 * @param attributes - The attributes a spawn writes, in the order it writes them
 * @param kinds - Each attribute's override kind for this pattern, parallel to `attributes`
 * @param positionKind - The position override's kind
 * @param shape - The stride, space and frame mode the function is built for
 * @returns The interpreted spawn function.
 * @internal
 */
export function generateSpawnPolyfill(
  attributes: readonly SpawnAttribute[],
  kinds: readonly number[],
  positionKind: number,
  shape: SpawnShape,
): SpawnFn {
  const { floatStride, world, randomFrames } = shape;
  const length = attributes.length;
  const table = new Int32Array(length * 5);
  const kindTable = Int32Array.from(kinds);
  const scratch = attributes.map((): PointData4D => ({ x: 0, y: 0, z: 0, w: 0 }));
  const row32 = new Uint32Array(floatStride);
  const row = new Float32Array(row32.buffer);
  const row16 = new Uint16Array(row32.buffer);

  for (let i = 0; i < length; i++) {
    const a = attributes[i];

    table.set([a.index + a.offset, a.components, a.source, a.store, a.spread], i * 5);
  }

  return (ctx, plan, clock, first, count) => {
    const { rng, spreads, shape, pos, dir, origin3, worldTransform, packedFrames, frameCount, packed, capacity } = ctx;
    const u32 = ctx.u32;
    const raws = plan.raw;
    const los = plan.lo;
    const his = plan.hi;
    const packedColor = plan.packedColor;
    let index = first;

    for (let n = 0; n < count; n++) {
      shape.sample(rng, pos, dir);

      if (positionKind !== ABSENT) {
        let origin: PointData3D;

        if (positionKind === CONSTANT) {
          origin = plan.positionRaw as PointData3D;
        } else if (positionKind === PAIR) {
          const lo = plan.positionLo;
          const hi = plan.positionHi;

          origin = origin3.set(lerp(lo.x, hi.x, rng()), lerp(lo.y, hi.y, rng()), lerp(lo.z, hi.z, rng()));
        } else {
          origin = (plan.positionRaw as (rng: () => number, index: number) => PointData3D)(rng, index);
        }

        pos.set(origin.x + pos.x, origin.y + pos.y, origin.z + pos.z);
      } else if (world) {
        pos.applyMatrix4(worldTransform);
      }

      if (world) dir.transformDirection(worldTransform);

      row[0] = pos.x;
      row[1] = pos.y;
      row[2] = pos.z;

      for (let i = 0, t = 0; i < length; i++, t += 5) {
        const kind = kindTable[i];
        const at = table[t];
        const components = table[t + 1];
        const source = table[t + 2];
        const store = table[t + 3];

        if (store === AS_FRAME) {
          const frame = randomFrames ? Math.floor(rng() * frameCount) : 0;
          const w = (frame % frameCount) * 4;
          const h = at * 2;

          row16[h] = packedFrames[w];
          row16[h + 1] = packedFrames[w + 1];
          row16[h + 2] = packedFrames[w + 2];
          row16[h + 3] = packedFrames[w + 3];
          continue;
        }

        if (store === AS_PACKED) {
          row32[at] = packed[i];
          continue;
        }

        if (components === 1) {
          let value: number;

          if (kind === ABSENT) {
            value =
              source === FROM_SPREAD ? sampleSpread(spreads, table[t + 4], rng) : source === FROM_CLOCK ? clock : 0;
          } else if (kind === CONSTANT) {
            value = raws[i] as number;
          } else if (kind === PAIR) {
            value = lerp(los[i] as number, his[i] as number, rng());
          } else {
            value = (raws[i] as (rng: () => number, index: number) => number)(rng, index);
          }

          if (store === AS_TINT) {
            const a8 = value <= 0 ? 0 : value >= 1 ? 255 : (value * 255 + 0.5) | 0;

            row32[at] = ((packedColor & 0xffffff) | (a8 << 24)) >>> 0;
          } else {
            row[at] = value;
          }

          continue;
        }

        const p = scratch[i];

        if (kind === ABSENT) {
          if (source === FROM_VELOCITY) {
            const speed = sampleSpread(spreads, SPEED_OFFSET, rng);

            p.x = dir.x * speed;
            p.y = dir.y * speed;
            p.z = dir.z * speed;
          } else {
            p.x = p.y = p.z = p.w = 0;
          }
        } else if (kind === CONSTANT) {
          const q = raws[i] as PointData4D;

          p.x = q.x;
          p.y = q.y;
          p.z = q.z;
          p.w = q.w;
        } else if (kind === PAIR) {
          const lo = los[i] as PointData4D;
          const hi = his[i] as PointData4D;

          p.x = lerp(lo.x, hi.x, rng());
          p.y = lerp(lo.y, hi.y, rng());
          if (components > 2) p.z = lerp(lo.z, hi.z, rng());
          if (components > 3) p.w = lerp(lo.w, hi.w, rng());
        } else {
          const q = (raws[i] as (rng: () => number, index: number) => PointData4D)(rng, index);

          p.x = q.x;
          p.y = q.y;
          p.z = q.z;
          p.w = q.w;
        }

        if (store === AS_F32) {
          row[at] = p.x;
          row[at + 1] = p.y;
          if (components > 2) row[at + 2] = p.z;
          if (components > 3) row[at + 3] = p.w;
        } else if (store === AS_UNORM8) {
          row32[at] = (unorm8(p.x) | (unorm8(p.y) << 8) | (unorm8(p.z) << 16) | (unorm8(p.w) << 24)) >>> 0;
        } else {
          const h = at * 2;

          row16[h] = unorm16(p.x);
          row16[h + 1] = unorm16(p.y);
          row16[h + 2] = unorm16(p.z);
          row16[h + 3] = unorm16(p.w);
        }
      }

      for (let v = 0, o = index * VERTS * floatStride; v < VERTS; v++, o += floatStride) {
        for (let k = 0; k < floatStride; k++) u32[o + k] = row32[k];
      }

      index = index + 1 === capacity ? 0 : index + 1;
    }

    return index;
  };
}
