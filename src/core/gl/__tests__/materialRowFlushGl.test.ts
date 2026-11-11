import { getApp, readCanvasPixels } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

describe('WebGL material store uniform buffer', () => {
  it("keeps a frame's material rows when no draw binds them before the next frame's change", async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'material-row-flush-gl',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE, backgroundColor: 0x0000ff },
    });

    try {
      const view3d = new View3D({ width: SIZE, height: SIZE });
      view3d.camera.position.set(0, 0, 3);
      app.stage.addChild(view3d);

      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      const unrelated = new FlatMaterial({ baseColor: 0x00ff00 });
      const unrelatedMesh = new Mesh3D({ geometry, material: unrelated });
      view3d.root.addChild(unrelatedMesh);
      app.render();
      unrelatedMesh.visible = false;

      const redMesh = new Mesh3D({ geometry, material: new FlatMaterial({ baseColor: 0xff0000 }) });
      redMesh.visible = false;
      view3d.root.addChild(redMesh);
      app.render();

      unrelated.baseColor = 0xffff00;
      app.render();

      redMesh.visible = true;
      app.render();

      const [r, g, b] = readCanvasPixels(app.canvas, SIZE / 2, SIZE / 2, 1, 1);
      expect(r - g > 48 && r - b > 48, `rgb(${r}, ${g}, ${b})`).toBe(true);
    } finally {
      app.destroy();
    }
  });
});
