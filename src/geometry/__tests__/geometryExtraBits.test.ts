import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Vector3 } from '~/math/vector/Vector3';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const shiftBit: ShaderBit = {
  name: 'geometryExtraBitsShift',
  level: 'shape',
  gpu: { vertex: { beforeTransform: 'position.x += 3.0;' } },
  gl: { vertex: { beforeTransform: 'position.x += 3.0;' } },
};

const positions = new Float32Array([0, 1, 0, -1, -1, 0, 1, -1, 0]);

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) n++;
  }
  return n;
}

describe('a geometry with extra bits', () => {
  it.each<[string, ShaderBit, RegExp]>([
    [
      'a level other than shape',
      { name: 'geometryExtraBitsCutout', level: 'cutout' },
      /'geometryExtraBitsCutout'.*has level 'cutout'/,
    ],
    ['no level', { name: 'geometryExtraBitsNoLevel' }, /'geometryExtraBitsNoLevel'.*has level 'color'/],
    [
      'a fragment slot',
      {
        name: 'geometryExtraBitsFragment',
        level: 'shape',
        gl: { fragment: { material: 'albedo = vec3(1.0);' } },
      },
      /'geometryExtraBitsFragment'.*fragment slot 'material'/,
    ],
    [
      'a material binding',
      { name: 'geometryExtraBitsMaterial', level: 'shape', bindings: { material: { uShift: 'f32' } } },
      /'geometryExtraBitsMaterial'.*'material' bindings/,
    ],
    [
      'an instance binding',
      { name: 'geometryExtraBitsInstance', level: 'shape', bindings: { instance: { shift: 'vec4<f32>' } } },
      /'geometryExtraBitsInstance'.*'instance' bindings/,
    ],
    [
      'a texture',
      { name: 'geometryExtraBitsTexture', level: 'shape', textures: ['wind'] },
      /'geometryExtraBitsTexture'.*declares textures/,
    ],
    [
      'a required bit with a fragment slot',
      {
        name: 'geometryExtraBitsRequiring',
        level: 'shape',
        requires: [{ name: 'geometryExtraBitsTint', gpu: { fragment: { end: 'finalColor = vec3<f32>(1.0);' } } }],
      },
      /'geometryExtraBitsTint', which 'geometryExtraBitsRequiring' requires,.*fragment slot 'end'/,
    ],
  ])('throws, naming the bit, for %s', (_, bit, message) => {
    expect(() => new Geometry3D({ positions, extraBits: [bit] })).toThrow(message);
  });

  it('accepts a shape bit with vertex code, a header, attributes and varyings', () => {
    const bit: ShaderBit = {
      name: 'geometryExtraBitsValid',
      level: 'shape',
      attributes: { aSide: 'float32' },
      interStage: { vSide: 'f32' },
      gpu: { header: 'fn side(s: f32) -> f32 { return s; }', vertex: { beforeTransform: 'position.x += 1.0;' } },
      gl: { header: 'float side(float s) { return s; }', vertex: { beforeTransform: 'position.x += 1.0;' } },
    };

    expect(new Geometry3D({ positions, extraBits: [bit] }).extraBits).toEqual([bit]);
  });
});

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a geometry's extra bits when drawn (${preference})`, () => {
    it('move the mesh and its shadow, as if the mesh stood where the bit moves it', async () => {
      const app = await getApp<Renderer>({
        id: `geometry-extra-bits-shadow-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101014 },
      });

      try {
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

        const shifted = new CubeGeometry({
          width: 1.5,
          height: 1.5,
          depth: 1.5,
          extraBits: [shiftBit],
          bounds3D: new Box(new Vector3(2.25, -0.75, -0.75), new Vector3(3.75, 0.75, 0.75)),
        });
        const plain = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const caster = new Mesh3D({ geometry: shifted, material: new Material3D({ baseColor: 0xd04040 }) });
        caster.position.set(-1.5, 1.5, 0);
        view3d.root.addChild(floor, sun, caster);

        const frame = async (geometry: Geometry3D, x: number, castShadow: boolean) => {
          caster.geometry = geometry;
          caster.position.x = x;
          caster.castShadow = castShadow;
          await renderFrame(app);

          return renderFrame(app);
        };

        expect(
          differingPixels(await frame(shifted, -1.5, false), await frame(plain, 1.5, false)),
          'the main pass draws the mesh three units to the right, where the bit moves it',
        ).toBeLessThan(10);
        expect(
          differingPixels(await frame(shifted, -1.5, true), await frame(plain, 1.5, true)),
          'the shadow pass casts its shadow from there too',
        ).toBeLessThan(10);
      } finally {
        app.destroy();
      }
    });

    it('leave a geometry with none on the shader it compiled before, and give one with a bit its own', async () => {
      const app = await getApp<Renderer>({
        id: `geometry-extra-bits-shared-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        view3d.camera.position.set(0, 0, 10);
        app.stage.addChild(view3d);

        const material = new Material3D();
        const meshes = [
          new CubeGeometry(),
          new CubeGeometry({ extraBits: [] }),
          new CubeGeometry({ extraBits: [shiftBit] }),
        ].map((geometry) => new Mesh3D({ geometry, material }));
        view3d.root.addChild(...meshes);

        await renderFrame(app);
        const [none, empty, withBit] = meshes.map((mesh) => mesh._passCache[RenderPassBit.OPAQUE].shader);

        expect(empty, 'an empty extraBits compiles the same shader as no option').toBe(none);
        expect(withBit, 'a geometry bit compiles a shader of its own').not.toBe(none);
      } finally {
        app.destroy();
      }
    });
  });
}
