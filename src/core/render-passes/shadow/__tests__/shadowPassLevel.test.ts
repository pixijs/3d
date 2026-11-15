import { getApp, renderFrame } from '@test-utils';
import type { Renderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

function shiftBit(name: string, level?: 'shape'): ShaderBit {
  return {
    name,
    level,
    gpu: { vertex: { beforeTransform: 'position.x += 3.0;' } },
    gl: { vertex: { beforeTransform: 'position.x += 3.0;' } },
  };
}

const shapeShiftBit = shiftBit('shadowLevelShapeShift', 'shape');
const colorShiftBit = shiftBit('shadowLevelColorShift');

function discardBit(name: string, level?: 'cutout'): ShaderBit {
  return {
    name,
    level,
    gpu: { fragment: { material: 'if (input.position.x >= 0.0) { discard; }' } },
    gl: { fragment: { material: 'if (gl_FragCoord.x >= 0.0) discard;' } },
  };
}

const instanceShiftBit: ShaderBit = {
  name: 'shadowLevelInstanceShift',
  level: 'shape',
  bindings: { instance: { shift: 'vec4<f32>' } },
  gpu: { vertex: { beforeTransform: 'position.x += instance.shift.x;' } },
  gl: { vertex: { beforeTransform: 'position.x += instance.shift.x;' } },
};

const SHIFT_DATA = { shift: { value: [0, 0, 0, 0], type: 'vec4<f32>' } } as const;

function oneCubeBatch(material: Material3D, geometry: CubeGeometry, x: number, z: number): BatchedMesh3D {
  const batched = new BatchedMesh3D({ size: 1, instanceData: SHIFT_DATA });

  batched.setGeometryAt(0, geometry);
  batched.setMaterialAt(0, material);
  batched.setMatrixAt(0, new Matrix4().makeTranslation(x, 1.5, z));
  batched.setPassesAt(0, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);

  return batched;
}

const tintBit: ShaderBit = {
  name: 'shadowLevelTint',
  overrideDefs: { SHADOW_LEVEL_TINT: { type: 'f32', default: 1 } },
  gpu: { fragment: { material: 'albedo = vec3<f32>(SHADOW_LEVEL_TINT);' } },
  gl: { fragment: { material: 'albedo = vec3(SHADOW_LEVEL_TINT);' } },
};

const cutoutDiscardBit = discardBit('shadowLevelCutoutDiscard', 'cutout');
const colorDiscardBit = discardBit('shadowLevelColorDiscard');

function meanXOfDifferingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) {
      sum += (i / 4) % SIZE;
      count++;
    }
  }

  return sum / count;
}

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) n++;
  }
  return n;
}

async function overridesReachThePipeline(renderer: Renderer): Promise<void> {
  const { limits } = renderer as WebGPURenderer;

  await vi.waitFor(() => {
    if (limits.supportsOverrideConstants === false) throw new Error('WebGPU still bakes overrides into the source');
  });
}

async function shadowView(preference: 'webgpu' | 'webgl', id: string) {
  const app = await getApp<Renderer>({
    id: `shadow-pass-level-${id}-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101014 },
  });
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
  view3d.camera.position.set(0, 12, 0.01);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  app.stage.addChild(view3d);

  const floor = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0xb0b0b0, metallic: 0, roughness: 0.95 }),
    castShadow: false,
  });
  floor.rotation.set(-Math.PI / 2, 0, 0);
  const sun = new DirectionalLight({ color: 0xffffff, intensity: 4, castShadow: true });
  sun.rotation.set((-45 * Math.PI) / 180, (35 * Math.PI) / 180, 0);
  view3d.root.addChild(floor, sun);

  return { app, view3d };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`the shadow pass at a level (${preference})`, () => {
    it('draws plain casters in one command per geometry, binding no material', async () => {
      const { app, view3d } = await shadowView(preference, 'plain');

      try {
        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        for (let i = 0; i < 6; i++) {
          const caster = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0x202020 * (i + 1) }) });
          caster.position.set(i * 1.5 - 3.75, 1, 0);
          view3d.root.addChild(caster);
        }

        await renderFrame(app);

        const list = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        expect(list.commandList.count, "one geometry and one shader: the materials don't split the draw").toBe(1);
        expect(list.commandList.commands[0].batchBindGroup).toBeUndefined();
      } finally {
        app.destroy();
      }
    });

    it("moves a caster's shadow with its material's shape bit, and not with a colour bit", async () => {
      const { app, view3d } = await shadowView(preference, 'shape');

      try {
        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const caster = new Mesh3D({ geometry, material: new Material3D({ extraBits: [shapeShiftBit] }) });
        caster.position.set(-1.5, 1.5, 0);
        view3d.root.addChild(caster);

        await renderFrame(app);
        const withShape = await renderFrame(app);

        caster.material = new Material3D({ extraBits: [colorShiftBit] });
        await renderFrame(app);
        const withColor = await renderFrame(app);

        expect(
          differingPixels(withShape, withColor),
          'both bits move the mesh, and only the shape bit moves its shadow',
        ).toBeGreaterThan(100);
      } finally {
        app.destroy();
      }
    });

    it('cuts a mask-mode caster out of its shadow where its alpha is under the cutoff', async () => {
      const { app, view3d } = await shadowView(preference, 'mask');

      try {
        const material = new Material3D({ alphaMode: 'mask', alpha: 0.2, alphaCutoff: 0.5 });
        const caster = new Mesh3D({ geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }), material });
        caster.position.set(0, 1.5, 0);
        view3d.root.addChild(caster);

        await renderFrame(app);
        const cut = await renderFrame(app);
        const list = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        expect(list.commandList.commands[0].batchBindGroup, 'the mask reads the material').toBeDefined();

        caster.castShadow = false;
        await renderFrame(app);
        const cutNotCasting = await renderFrame(app);
        expect(differingPixels(cut, cutNotCasting), 'alpha 0.2 is under the cutoff, so nothing casts').toBeLessThan(10);

        caster.castShadow = true;
        material.alphaCutoff = 0.1;
        await renderFrame(app);
        const kept = await renderFrame(app);

        caster.castShadow = false;
        await renderFrame(app);
        const keptNotCasting = await renderFrame(app);
        expect(differingPixels(kept, keptNotCasting), 'alpha 0.2 is over the cutoff, so it casts').toBeGreaterThan(100);
      } finally {
        app.destroy();
      }
    });

    it('casts a shadow for a material whose overrides belong to a bit its shadow leaves out', async () => {
      const { app, view3d } = await shadowView(preference, 'overrides');

      try {
        const material = new BaseMaterial3D({
          descriptor: { bitsGpu: [tintBit], bitsGl: [tintBit], overrides: { SHADOW_LEVEL_TINT: 0.5 } },
        });
        const caster = new Mesh3D({ geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }), material });
        caster.position.set(0, 1.5, 0);
        view3d.root.addChild(caster);

        await overridesReachThePipeline(app.renderer);

        await renderFrame(app);
        const casting = await renderFrame(app);
        caster.castShadow = false;
        await renderFrame(app);
        const notCasting = await renderFrame(app);

        expect(differingPixels(casting, notCasting), 'the mesh casts').toBeGreaterThan(100);
      } finally {
        app.destroy();
      }
    });

    it("moves a batch slot's shadow with a shape bit that reads the slot's own instance data", async () => {
      const { app, view3d } = await shadowView(preference, 'instance');

      try {
        const material = new Material3D({ baseColor: 0x808080, extraBits: [instanceShiftBit] });
        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const shifted = oneCubeBatch(material, geometry, -2, 0);
        const still = oneCubeBatch(material, geometry, 0, 4);
        view3d.root.addChild(shifted, still);

        const shadowX = async (x: number, shift: number): Promise<number> => {
          shifted.setMatrixAt(0, new Matrix4().makeTranslation(x, 1.5, 0));
          shifted.setInstanceDataAt(0, 'shift', shift, 0, 0, 0);
          shifted.setPassesAt(0, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
          await renderFrame(app);
          const casting = await renderFrame(app);
          shifted.setPassesAt(0, RenderPassBit.OPAQUE);
          await renderFrame(app);

          return meanXOfDifferingPixels(casting, await renderFrame(app));
        };

        const shiftedByBit = await shadowX(-2, 4);
        const placedThere = await shadowX(2, 0);
        const unshifted = await shadowX(-2, 0);

        expect(Math.abs(shiftedByBit - placedThere), 'the shadow lies where a cube placed there casts it').toBeLessThan(
          3,
        );
        expect(Math.abs(shiftedByBit - unshifted), 'and not where the slot stands before the bit runs').toBeGreaterThan(
          8,
        );
      } finally {
        app.destroy();
      }
    });

    it("cuts a shadow with a material's own cutout bit, and not with a colour bit that discards", async () => {
      const { app, view3d } = await shadowView(preference, 'discard');

      try {
        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const caster = new Mesh3D({ geometry, material: new Material3D({ extraBits: [cutoutDiscardBit] }) });
        caster.position.set(0, 1.5, 0);
        view3d.root.addChild(caster);

        await renderFrame(app);
        const cutout = await renderFrame(app);
        caster.castShadow = false;
        await renderFrame(app);
        const cutoutNotCasting = await renderFrame(app);
        expect(differingPixels(cutout, cutoutNotCasting), 'the cutout bit discards in the shadow too').toBeLessThan(10);

        caster.castShadow = true;
        caster.material = new Material3D({ extraBits: [colorDiscardBit] });
        await renderFrame(app);
        const color = await renderFrame(app);
        caster.castShadow = false;
        await renderFrame(app);
        const colorNotCasting = await renderFrame(app);
        expect(differingPixels(color, colorNotCasting), 'the colour bit is dropped, so the mesh casts').toBeGreaterThan(
          100,
        );
      } finally {
        app.destroy();
      }
    });
  });
}
