import { getApp, readCanvasPixels } from '@test-utils';
import { State } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { passBitRegistry } from '~/core/render-passes/passBitRegistry';
import { solidMeshDescriptor } from '~/extras/post-processing/passes/solidMeshShader';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;
const MATERIALS = 20;

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a custom pass whose shader comes from each material (${preference})`, () => {
    it('draws every material in one command and binds no material group', async () => {
      const app = await getApp<Renderer>({
        id: `per-material-pass-shader-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x0000ff },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, passes: [new MeshPass({ name: 'xray' })] });
        view3d.camera.position.set(0, 0, 10);
        app.stage.addChild(view3d);

        const xrayState = new State();
        const xray = { shaderDescriptor: solidMeshDescriptor({ color: 0x00ff00 }), state: xrayState };
        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        for (let i = 0; i < MATERIALS; i++) {
          const mesh = new Mesh3D({
            geometry,
            material: new Material3D({ baseColor: (i * 0x0c0c0c) & 0xffffff, passes: { xray } }),
          });
          const [column, row] = [(i % 5) - 2, Math.floor(i / 5) - 2];
          mesh.position.set(column * 1.5, row * 1.5, 0);
          view3d.root.addChild(mesh);
        }

        expect(() => app.render()).not.toThrow();

        const list = view3d._sceneBatch.drawLists[passBitRegistry.getOrAllocate('xray')];
        expect(list.commandList.count, "one geometry and one shader: the materials don't split the draw").toBe(1);
        expect(list.drawData.drawCalls[1]).toBe(MATERIALS);
        expect(
          list.commandList.commands[0].batchBindGroup,
          'the shader is compiled without the material bindings, so group 2 stays empty',
        ).toBeUndefined();

        const [r, g, b] = readCanvasPixels(app.canvas, SIZE / 2, SIZE / 2, 1, 1);
        expect(g - r > 48 && g - b > 48, `rgb(${r}, ${g}, ${b})`).toBe(true);
      } finally {
        app.destroy();
      }
    });
  });
}
