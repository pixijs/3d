import { getApp } from '@test-utils';
import { TextureSource } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const defaultMipmaps = TextureSource.defaultOptions.autoGenerateMipmaps;

function readCenter(app: { renderer: unknown }): [number, number, number] {
  const gl = (app.renderer as { gl: WebGL2RenderingContext }).gl;
  const out = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0], out[1], out[2]];
}

describe("pixi's mipmap default (WebGL)", () => {
  afterEach(() => {
    TextureSource.defaultOptions.autoGenerateMipmaps = defaultMipmaps;
  });

  it('a lit mesh draws when the app turns autoGenerateMipmaps on for every texture', async () => {
    TextureSource.defaultOptions.autoGenerateMipmaps = true;
    const app = await getApp<WebGLRenderer>({
      id: 'integer-mipmaps-gl',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });
    try {
      const gl = (app.renderer as { gl: WebGL2RenderingContext }).gl;
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 3);

      const light = new DirectionalLight({ color: 0xffffff, intensity: 3 });
      light.position.set(2, 3, 4);
      light.lookAt(view3d.root.position);
      view3d.root.addChild(
        new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0xff2020 }) }),
        light,
      );

      app.render();

      expect(gl.getError(), 'no texture upload fails, generateMipmap included').toBe(gl.NO_ERROR);
      const [red, , blue] = readCenter(app);
      expect(red, 'the red cube covers the middle of the view, where the clear colour is black').toBeGreaterThan(
        blue + 20,
      );
    } finally {
      app.destroy();
    }
  });
});
