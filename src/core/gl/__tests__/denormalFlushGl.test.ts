import { getApp, readCanvasPixels } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { integerFieldsBit } from '~/core/shader/__tests__/integerFieldsBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Flushes denormals out of every float-texture `texelFetch`; integer textures pass through,
 * as they do on real hardware. The overloads are declared before the `#define`, so their
 * bodies keep the real `texelFetch`.
 */
const FLUSH_DENORMALS = /* glsl */ `
highp vec4 flushedTexelFetch(highp sampler2D s, ivec2 p, int l) {
  highp vec4 v = texelFetch(s, p, l);
  return v * vec4(greaterThanEqual(abs(v), vec4(1.17549435e-38)));
}
highp uvec4 flushedTexelFetch(highp usampler2D s, ivec2 p, int l) { return texelFetch(s, p, l); }
#define texelFetch flushedTexelFetch
`;

/**
 * Injects {@link FLUSH_DENORMALS} after the `#version` line of every shader the renderer compiles
 *
 * Some GPUs flush denormal floats to zero when they fetch from a float texture. Every integer
 * below 2^23 has the bit pattern of a denormal float, so a store that ships integers through a
 * float texture reads them all back as 0 there. Desktop and Apple GPUs keep denormals, so no
 * visual scene can catch it; these tests simulate the flush and check each integer the engine
 * reads still arrives.
 */
function simulateDenormalFlush(renderer: WebGLRenderer): void {
  const gl = renderer.gl;
  const shaderSource = gl.shaderSource.bind(gl);

  gl.shaderSource = (shader, source) => {
    const afterVersion = source.indexOf('\n') + 1;
    shaderSource(shader, source.slice(0, afterVersion) + FLUSH_DENORMALS + source.slice(afterVersion));
  };
}

describe('WebGL on a GPU that flushes denormal texel fetches', () => {
  it('draws every mesh with its own material', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'denormal-flush-materials',
      appOptions: { preference: 'webgl', width: 240, height: 80, backgroundColor: 0x000000 },
    });
    try {
      simulateDenormalFlush(app.renderer);

      const view3d = new View3D({ width: 240, height: 80 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 6);

      const colours = [0xff0000, 0x00ff00, 0x0000ff];
      colours.forEach((baseColor, i) => {
        const mesh = new Mesh3D({ geometry: new SphereGeometry(), material: new FlatMaterial({ baseColor }) });
        mesh.position.set((i - 1) * 2.4, 0, 0);
        view3d.root.addChild(mesh);
      });

      app.render();

      const pixels = readCanvasPixels(app.canvas);
      const counts = [0, 0, 0];
      for (let p = 0; p < pixels.length; p += 4) {
        const max = Math.max(pixels[p], pixels[p + 1], pixels[p + 2]);
        if (max > 64) counts[[pixels[p], pixels[p + 1], pixels[p + 2]].indexOf(max)]++;
      }

      expect(
        counts.every((count) => count > 200),
        `pixels by strongest channel, all red if every mesh read material 0: ${counts.join(', ')}`,
      ).toBe(true);
    } finally {
      app.destroy(true);
    }
  });

  it('applies morph targets', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'denormal-flush-morph',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });
    try {
      simulateDenormalFlush(app.renderer);

      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 2.6);

      const plain = new Mesh3D({
        geometry: new Geometry3D({
          positions: new Float32Array([-0.1, -0.1, 0, 0.1, -0.1, 0, 0, 0.1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
        }),
        material: new FlatMaterial({ baseColor: 0xff0000 }),
      });
      plain.position.set(-1.2, -1.2, 0);
      view3d.root.addChild(plain);

      const geometry = new Geometry3D({
        positions: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2.5, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        morphTargets: [{ positions: new Float32Array([50, 0, 0, 50, 0, 0, 50, 0, 0]) }],
      });
      const mesh = new Mesh3D({ geometry, material: new FlatMaterial({ baseColor: 0x00ff00, doubleSided: true }) });
      view3d.root.addChild(mesh);

      const centreGreen = () => readCanvasPixels(app.canvas, 32, 32, 1, 1)[1];

      app.render();
      expect(centreGreen(), 'the triangle covers the centre at weight 0').toBeGreaterThan(200);
      expect(
        geometry._geometryDataIndex,
        'the plain triangle took geometry row 0, so a flushed row index would read the wrong row',
      ).toBeGreaterThan(0);

      mesh.weights![0] = 1;
      app.render();
      expect(centreGreen(), 'the morph moved the triangle off-screen, so the morph facts and weight arrived').toBe(0);
    } finally {
      app.destroy(true);
    }
  });

  it('reads integer material fields exactly', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'denormal-flush-integer-fields',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });
    try {
      simulateDenormalFlush(app.renderer);

      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 4);

      const material = new FlatMaterial({ baseColor: 0xffffff, extraBits: [integerFieldsBit] });
      material.data.flags = 3;
      material.data.offset = -2;
      view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material }));

      const centre = () => readCanvasPixels(app.canvas, 32, 32, 1, 1);

      app.render();
      const [red, green] = centre();
      expect(red, 'flags reads 3, whose bit pattern is a denormal float').toBeGreaterThan(200);
      expect(green, 'offset reads -2, through the signed conversion').toBeGreaterThan(200);

      material.data.flags = 4;
      material.data.offset = 2;
      app.render();
      const [redAfter, greenAfter] = centre();
      expect(redAfter, 'flags reads the new value').toBe(0);
      expect(greenAfter, 'offset reads the new value').toBe(0);
    } finally {
      app.destroy(true);
    }
  });
});
