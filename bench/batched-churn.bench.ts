/**
 * `batched churn`: one `BatchedMesh3D` of `slots` slots over 8 geometries and 4 plain materials, standing still,
 * with a sixth of them out at any moment. Every frame `births` slots go out and as many others come in. A slot goes
 * out one of two ways: `active` takes it out of its pass with `setPassesAt(i, 0)` and puts it back with
 * `setPassesAt(i, OPAQUE)`; `visible` hides and shows it with `setVisibleAt`. `active-writes` is `active` that also
 * rewrites each changed slot's unchanged matrix, so it uploads the same scattered store rows `visible` does: the
 * control that says how much of `visible`'s GPU time is that upload. Those three run 24 000 slots with `births` at
 * 100 and draw the same frame. `visible-n10` changes 10 slots a frame instead, and `visible-50k`, `visible-100k` and
 * `active-100k` grow the batch.
 *
 * `active-paired` is `active` as a pool plays it: the window still says which slots die each frame, but each death
 * brings back the oldest dead slot of the same geometry and material, so every frame's births match its deaths kind
 * for kind. It draws a frame of its own. `active-paired-6k` is the same over 6000 slots, light enough on the GPU for
 * the host's share of the frame to be read on a desktop, and `active-paired-1` is one slot out and one of its kind
 * back in per frame over 5000: the smallest change a list can see. A pass that starts over puts the pool back as frame
 * 0 has it, so every pass churns the same slots.
 *
 * `merged` and `merged-paired` spread the slots over 32 plain materials instead of 4. Plain materials share one
 * texture set, so each geometry's run holds 32 materials, more than a run draws one command per material for, and
 * draws merged. `single-kind` and `single-kind-100k` give every slot one geometry and one material: one command
 * holding the whole batch.
 *
 * `swap` and `swap-6k` take no slot out: every frame `births` slots, in turn from a shuffled order, swap to the next
 * of the scene's materials with `setMaterialAt`. Every geometry is drawn in every material, so each swap moves a slot
 * to a kind the batch already draws. A pass that starts over puts every slot back on its first material.
 *
 * `blink` leaves the batch alone and blinks two pools of `births` slots: after a first frame with neither, every frame
 * one pool leaves its pass and the other joins. Each blinking slot draws a material with maps of its own, so every join is a kind no built command
 * draws and every departure is a slot that joined that way: the only change a frame makes is to the slots a list
 * draws apart from its built commands.
 *
 * Judged on `cpu.frame`: the calls are the update's and what they cost the engine is the render's, so the question,
 * which way of hiding a slot is cheaper, is the whole frame.
 *
 * Who is out is a function of the frame alone. The slots out are a window over a sixth of a shuffled order of the
 * slots. The window moves `births` places a frame, so arms with the same `slots` and `births` hide the same slots on
 * the same frame. The `-paired` variants take their deaths from the window but their births from the pool, so they
 * depend on the frames before them as well, from the start of the pass.
 */

import { BatchedMesh3D, Material3D, Matrix4, RenderPassBit } from '@pixi/3d';
import { frame } from 'benchy';

import { instancedChurnScene } from './data/field.ts';
import { rng } from './data/rng.ts';
import { proceduralMaps } from './data/textures.ts';
import { applyLook, displayColor, toGeometry, toMaterial, toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** Share of the slots out at any moment. */
const OUT_SHARE = 1 / 6;

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

frame('batched churn', {
  variants: {
    active: { hide: 'active', births: 100, slots: 24_000, materials: 4, geometries: 8 },
    visible: { hide: 'visible', births: 100, slots: 24_000, materials: 4, geometries: 8 },
    'active-writes': { hide: 'active-writes', births: 100, slots: 24_000, materials: 4, geometries: 8 },
    'visible-n10': { hide: 'visible', births: 10, slots: 24_000, materials: 4, geometries: 8 },
    'active-100k': { hide: 'active', births: 100, slots: 100_000, materials: 4, geometries: 8 },
    'visible-100k': { hide: 'visible', births: 100, slots: 100_000, materials: 4, geometries: 8 },
    'visible-50k': { hide: 'visible', births: 100, slots: 50_000, materials: 4, geometries: 8 },
    'active-paired': { hide: 'active-paired', births: 100, slots: 24_000, materials: 4, geometries: 8 },
    'active-paired-6k': { hide: 'active-paired', births: 100, slots: 6000, materials: 4, geometries: 8 },
    'active-paired-1': { hide: 'active-paired', births: 1, slots: 5000, materials: 4, geometries: 8 },
    merged: { hide: 'active', births: 100, slots: 24_000, materials: 32, geometries: 8 },
    'merged-paired': { hide: 'active-paired', births: 100, slots: 24_000, materials: 32, geometries: 8 },
    'single-kind': { hide: 'active', births: 100, slots: 24_000, materials: 1, geometries: 1 },
    'single-kind-100k': { hide: 'active', births: 100, slots: 100_000, materials: 1, geometries: 1 },
    swap: { hide: 'swap', births: 100, slots: 24_000, materials: 4, geometries: 8 },
    'swap-6k': { hide: 'swap', births: 100, slots: 6000, materials: 4, geometries: 8 },
    blink: { hide: 'blink', births: 10, slots: 24_000, materials: 4, geometries: 8 },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  create(
    stage: PixiStage,
    {
      hide,
      births,
      slots,
      materials: materialCount,
      geometries: geometryCount,
    }: {
      hide: 'active' | 'visible' | 'active-writes' | 'active-paired' | 'swap' | 'blink';
      births: number;
      slots: number;
      materials: number;
      geometries: number;
    },
  ) {
    const data = instancedChurnScene(slots, materialCount, geometryCount);
    applyLook(stage, data.look);
    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map(toMaterial);
    const count = data.count;
    const batch = new BatchedMesh3D({ size: count });
    for (let i = 0; i < count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material)
        throw new Error(`batched churn: slot ${i} names a geometry or material that is not there`);
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
    const scratch = new Matrix4();
    const setShown = (slot: number, shown: boolean): void => {
      if (hide === 'visible') {
        batch.setVisibleAt(slot, shown);
        return;
      }
      batch.setPassesAt(slot, shown ? RenderPassBit.OPAQUE : 0);
      if (hide === 'active-writes') batch.setMatrixAt(slot, scratch.fromArray(matrixData, offset + slot * stride));
    };
    /** `blink`: the two pools of `births` slots, each drawing a material with maps of its own */
    const blinkers = hide === 'blink' ? order.slice(0, births * 2) : [];
    const isBlinker = new Uint8Array(count);
    const blinkMaterials = blinkers.map((slot, k) => {
      isBlinker[slot] = 1;
      const spec = data.materials[data.material[slot] ?? 0];
      if (!spec) throw new Error(`batched churn: slot ${slot} names a material that is not there`);
      const maps = proceduralMaps(k, 16);
      const material = new Material3D({
        baseColor: displayColor(spec.color),
        baseColorTexture: toTexture(maps.albedo, `blink-albedo-${k}`),
      });
      batch.setMaterialAt(slot, material);
      return material;
    });
    /**
     * `blink`: the pool in its pass, or -1 for none. A pass's first frame shows neither, so the list is built without
     * them and every pool that joins later is a kind no built command draws; a restart leaves it for that frame to hide
     */
    let blinkPool = -1;
    /** The slot's geometry and material, as one index over the scene's instance groups */
    const kindOf = (slot: number): number => (data.geom[slot] ?? 0) * materialCount + (data.material[slot] ?? 0);
    /** `active-paired`: the dead slots of each kind, oldest first, which its births come from */
    const deadByKind: number[][] = Array.from({ length: geometryCount * materialCount }, () => []);
    const shownNow = new Uint8Array(count).fill(1);
    /** `swap`: each slot's current material */
    const slotMaterial = Uint8Array.from(data.material);
    let frameIndex = 0;
    let lastFrame = 0;
    /**
     * Puts every slot as frame 0 has it: the window's sixth out (none for `swap`), each slot on its first material,
     * and each kind's dead slots queued in slot order
     */
    const restart = (): void => {
      for (const dead of deadByKind) dead.length = 0;
      for (let i = 0; i < count; i++) {
        const first = data.material[i] ?? 0;
        if (slotMaterial[i] !== first) {
          batch.setMaterialAt(i, materials[first] as Material3D);
          slotMaterial[i] = first;
        }
        const wanted = hide === 'swap' || (hide === 'blink' ? !isBlinker[i] : !isOut(i, 0)) ? 1 : 0;
        if (!wanted) deadByKind[kindOf(i)]?.push(i);
        if (shownNow[i] === wanted) continue;
        setShown(i, wanted === 1);
        shownNow[i] = wanted;
      }
      lastFrame = 0;
    };
    restart();

    return {
      simulate(seconds) {
        frameIndex = Math.round(seconds * 60);
      },
      update() {
        if (hide === 'blink') {
          if (frameIndex < lastFrame) restart();
          const pool = frameIndex === 0 ? -1 : frameIndex & 1;
          if (pool !== blinkPool) {
            for (let k = 0; k < births; k++) {
              if (blinkPool >= 0) setShown(blinkers[blinkPool * births + k] ?? 0, false);
              if (pool >= 0) setShown(blinkers[pool * births + k] ?? 0, true);
            }
            blinkPool = pool;
          }
          lastFrame = frameIndex;
          return;
        }
        if (hide === 'swap') {
          if (frameIndex < lastFrame) restart();
          const swaps = Math.min((frameIndex - lastFrame) * births, count);
          for (let k = 0; k < swaps; k++) {
            const slot = order[(lastFrame * births + k) % count] ?? 0;
            const next = ((slotMaterial[slot] ?? 0) + 1) % materialCount;
            batch.setMaterialAt(slot, materials[next] as Material3D);
            slotMaterial[slot] = next;
          }
          lastFrame = frameIndex;
          return;
        }
        if (hide === 'active-paired') {
          if (frameIndex < lastFrame) restart();
          for (let i = 0; i < count; i++) {
            if (!shownNow[i] || !isOut(i, frameIndex) || isOut(i, lastFrame)) continue;
            setShown(i, false);
            shownNow[i] = 0;
            const dead = deadByKind[kindOf(i)];
            if (!dead) continue;
            dead.push(i);
            const born = dead.length > 1 ? dead.shift() : undefined;
            if (born === undefined) continue;
            setShown(born, true);
            shownNow[born] = 1;
          }
          lastFrame = frameIndex;
          return;
        }
        for (let i = 0; i < count; i++) {
          const wanted = isOut(i, frameIndex) ? 0 : 1;
          if (shownNow[i] === wanted) continue;
          setShown(i, wanted === 1);
          shownNow[i] = wanted;
        }
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy(true);
        for (const material of blinkMaterials) material.destroy(true);
      },
    };
  },
});
