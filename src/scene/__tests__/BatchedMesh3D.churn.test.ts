import { getApp, readCanvasPixels } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;
const GRID = 8;
const SLOTS = GRID * GRID;

const OUT = 16;

const BIRTHS = 4;

type HideMode = 'setPassesAt' | 'setVisibleAt';

const CULLS = { webgpu: ['off', 'gpu'], webgl: ['off', 'cpu'] } as const;

const place = Array.from({ length: SLOTS }, (_, i) => (i * 37) % SLOTS);

const isOut = (slot: number, frame: number): boolean =>
  (((place[slot] - frame * BIRTHS) % SLOTS) + SLOTS) % SLOTS < OUT;

function setShown(batched: BatchedMesh3D, slot: number, shown: boolean, mode: HideMode): void {
  if (mode === 'setVisibleAt') batched.setVisibleAt(slot, shown);
  else batched.setPassesAt(slot, shown ? RenderPassBit.OPAQUE : 0);
}

const cube = (): CubeGeometry => new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 });

function build(
  mode: HideMode,
  frame: number,
  geometry: CubeGeometry,
  cull: CullMode = 'off',
): { view3d: View3D; batched: BatchedMesh3D } {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.camera.position.set(0, 0, 14);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  const material = new FlatMaterial({ baseColor: 0xc06c4a });
  const batched = new BatchedMesh3D({ size: SLOTS, cull });
  const matrix = new Matrix4();
  for (let i = 0; i < SLOTS; i++) {
    matrix.elements[12] = (i % GRID) - GRID / 2 + 0.5;
    matrix.elements[13] = Math.floor(i / GRID) - GRID / 2 + 0.5;
    batched.setMatrixAt(i, matrix);
    batched.setGeometryAt(i, geometry);
    batched.setMaterialAt(i, material);
    batched.setPassesAt(i, RenderPassBit.OPAQUE);
  }
  for (let i = 0; i < SLOTS; i++) if (isOut(i, frame)) setShown(batched, i, false, mode);
  view3d.root.addChild(batched);
  return { view3d, batched };
}

function renderAndRead(app: Application<Renderer>): Uint8ClampedArray {
  app.render();
  return readCanvasPixels(app.canvas);
}

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
  }
  return n;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`BatchedMesh3D churn (${preference})`, () => {
    const cases: { mode: HideMode; cull: CullMode }[] = [
      { mode: 'setPassesAt', cull: 'off' },
      ...CULLS[preference].map((cull) => ({ mode: 'setVisibleAt' as const, cull })),
    ];
    for (const { mode, cull } of cases) {
      it(`draws what a freshly built batch draws, frame after frame, when ${mode} moves slots out and in (cull '${cull}')`, async () => {
        const app = await getApp<Renderer>({
          id: `batched-churn-${mode}-${cull}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });
        const reference = await getApp<Renderer>({
          id: `batched-churn-reference-${mode}-${cull}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });

        try {
          const churned = build(mode, 0, cube(), cull);
          const referenceCube = cube();
          app.stage.addChild(churned.view3d);
          let previous = renderAndRead(app);

          const mismatches: string[] = [];
          for (let frame = 1; frame <= 12; frame++) {
            for (let i = 0; i < SLOTS; i++) {
              const shown = !isOut(i, frame);
              if (shown !== !isOut(i, frame - 1)) setShown(churned.batched, i, shown, mode);
            }
            const drawn = renderAndRead(app);

            const fresh = build('setPassesAt', frame, referenceCube);
            reference.stage.addChild(fresh.view3d);
            const expected = renderAndRead(reference);
            if (differingPixels(expected, previous) === 0)
              mismatches.push(`frame ${frame}: looks like the frame before, so it proves nothing`);
            previous = expected;
            reference.stage.removeChild(fresh.view3d);
            fresh.view3d.destroy();

            const differing = differingPixels(drawn, expected);
            if (differing > 0) mismatches.push(`frame ${frame}: ${differing} pixels differ`);
          }
          expect(mismatches).toEqual([]);
        } finally {
          app.destroy();
          reference.destroy();
        }
      });
    }
  });
}
