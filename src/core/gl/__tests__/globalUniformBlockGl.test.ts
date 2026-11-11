import { getApp } from '@test-utils';
import type { BindGroup, UniformGroup, WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { Mesh3DData } from '~/core/batcher/Mesh3DData';
import { getGlobalGlData } from '~/core/gl/shader/globalBitGl';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const template: ShaderBitTemplate = {
  bindGroups: [{ name: 'global', ubo: true }],
  gpu: '{{header}}',
  gl: {
    vertex: '#version 300 es\n{{header}}\nvoid main() {}',
    fragment: '#version 300 es\n{{header}}\nvoid main() {}',
  },
};

const GLOBAL_SLOTS = [
  'global',
  'uEnvironmentTexture',
  'uBrdfLutTexture',
  'uMaterialStorage',
  'uShadowMap',
  'uBonePitTexture',
  'uOpaqueDepthTexture',
  'uOpaqueColorTexture',
  'uMorphTexture',
  'uGeometryTexture',
  'uMeshStoreTexture',
  'uRenderInstanceTexture',
  'batchTransform',
];

const SHADOW_SLOTS = [
  'uBonePitTexture',
  'uMorphTexture',
  'uGeometryTexture',
  'uMeshStoreTexture',
  'uRenderInstanceTexture',
  'batchTransform',
];

function expectSlots(group: BindGroup, slots: string[], uniformGroups: Record<string, UniformGroup>): void {
  const wrong = slots.filter((name) => {
    const resource = group.getResource(name);

    return name in uniformGroups ? resource !== uniformGroups[name] : resource._resourceType === 'uniformGroup';
  });

  expect(wrong).toEqual([]);
}

function slotMap(slots: string[]): Record<number, string> {
  return Object.fromEntries(slots.map((name, slot) => [slot, name]));
}

describe('WebGL global uniform block', () => {
  it("refuses a template that takes the global bit but lists 'global' as a plain bind group", async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'global-uniform-block-missing-gl',
      appOptions: { preference: 'webgl', width: 16, height: 16 },
    });

    try {
      const plain: ShaderBitTemplate = { bindGroups: ['global', 'camera'], gl: template.gl };

      expect(() => app.renderer.material3d.compilePassShader([], plain)).toThrow(/\{ name: 'global', ubo: true \}/);
    } finally {
      app.destroy(true, { children: true });
    }
  });

  it('draws every mesh shader with the slots its bind group fills, and lays the block out as pixi does', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'global-uniform-block-slots-gl',
      appOptions: { preference: 'webgl', width: 64, height: 64 },
    });

    try {
      const view3d = new View3D({
        width: 64,
        height: 64,
        environment: { skyColor: 0xffffff, groundColor: 0x334455 },
        fog: { type: 'linear', near: 1, far: 20 },
        passes: [new OutlinePass({ width: 0.02 })],
      });
      const sun = new DirectionalLight({ intensity: 3, castShadow: true });
      sun.position.set(5, 8, 5);
      sun.lookAt({ x: 0, y: 0, z: 0 });

      const ground = new Mesh3D({ geometry: new PlaneGeometry({ width: 10, height: 10 }), material: new Material3D() });
      ground.rotation.set(-Math.PI / 2, 0, 0);
      const ball = new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D() });
      ball.material.enablePass('outline');
      const morph = new Mesh3D({
        geometry: new Geometry3D({
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
          morphTargets: [{ positions: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) }],
        }),
        material: new Material3D(),
        weights: new Float32Array([1]),
      });
      morph.material.enablePass('outline');
      const batched = new BatchedMesh3D({ size: 1 });
      batched.setGeometryAt(0, new CubeGeometry());
      batched.setMaterialAt(0, new FlatMaterial());
      batched.setMatrixAt(0, new Matrix4());
      batched.setPassesAt(0, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);

      view3d.root.addChild(sun, ground, ball, morph, batched);
      view3d.camera.position.set(0, 3, 6);
      view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
      app.stage.addChild(view3d);
      app.render();

      const renderer = app.renderer;
      const gl = renderer.gl;
      const { globalUniformGroup, globalBindGroup } = getGlobalGlData(view3d, renderer);
      const { batchTransform } = renderer.material3d.batcher;

      expectSlots(globalBindGroup, GLOBAL_SLOTS, { global: globalUniformGroup, batchTransform });
      expect(
        Object.keys(globalBindGroup.layout!),
        'the global group names every binding the shadow shader declares',
      ).toEqual(expect.arrayContaining(SHADOW_SLOTS));

      const items: Mesh3DData[] = [ground, ball, morph, batched.batch.items[0]];
      const passes = new Set<string>();
      for (const item of items) {
        for (const bit in item._passCache) {
          const pass = view3d.passByBit[Number(bit)];
          const slots = pass.bit === RenderPassBit.SHADOW ? SHADOW_SLOTS : GLOBAL_SLOTS;

          expect(item._passCache[bit].shader._uniformBindMap[0], `mesh ${item.uid}, pass ${pass.name}`).toEqual(
            slotMap(slots),
          );
          passes.add(pass.name);
        }
      }
      expect([...passes], 'a shader of each kind was checked').toEqual(
        expect.arrayContaining(['opaque', 'shadow', 'outline']),
      );

      const { layout } = renderer.ubo.getUniformGroupData(globalUniformGroup);
      const names = layout.uboElements.map(({ data }) => `${data.name}${(data.size ?? 1) > 1 ? '[0]' : ''}`);
      for (const item of items) {
        const { program } = renderer.shader._getProgramData(item._passCache[RenderPassBit.OPAQUE].shader.glProgram);
        const block = gl.getUniformBlockIndex(program, 'global');

        expect(gl.getActiveUniformBlockParameter(program, block, gl.UNIFORM_BLOCK_DATA_SIZE)).toBe(layout.size);
        expect(gl.getActiveUniforms(program, gl.getUniformIndices(program, names) ?? [], gl.UNIFORM_OFFSET)).toEqual(
          layout.uboElements.map(({ offset }) => offset),
        );
      }
      expect(gl.getError()).toBe(gl.NO_ERROR);

      view3d.destroy({ children: true });
    } finally {
      app.destroy(true, { children: true });
    }
  });
});
