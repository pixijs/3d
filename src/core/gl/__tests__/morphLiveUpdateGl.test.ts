import { getApp } from '@test-utils';
import { Assets } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

// Live morph animation on WebGL: weight changes after the data textures exist
// must reach the GPU. The visual scenes can't catch this — they set weights
// before the first render, so the lazily-created textures are born with the
// final data and a stale update path still snapshots green.
//
// This test follows the playground order instead: render with an empty view
// (textures created empty), add a morphed mesh, render, then change the
// weights and check the pixels actually move.

/** Reads the centre pixel of the canvas straight off the GL backbuffer. */
function readCenter(app: { renderer: unknown }): [number, number, number] {
  const gl = (app.renderer as { gl: WebGL2RenderingContext }).gl;
  const out = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0], out[1], out[2]];
}

/** Reads the full backbuffer for frame-to-frame diffing. */
function readFrame(app: { renderer: unknown }): Uint8Array {
  const gl = (app.renderer as { gl: WebGL2RenderingContext }).gl;
  const out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

function countDifferingPixels(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 4 || Math.abs(a[i + 1] - b[i + 1]) > 4 || Math.abs(a[i + 2] - b[i + 2]) > 4) count++;
  }
  return count;
}

describe('morph live weight updates (WebGL)', () => {
  it('re-renders when weights change after the data textures exist', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'morph-gl-live-update',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });
    try {
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 2.6);

      const light = new DirectionalLight({ color: 0xffffff, intensity: 9 });
      light.rotation.set(0.18, 0.12, 0);
      view3d.root.addChild(light);

      // Two empty frames: the lazy morph + geometry data textures get created
      // with no morph facts in them, exactly like an app whose model loads async.
      app.render();
      app.render();

      // A camera-filling triangle whose single morph target shoves it far
      // off-screen: weight 0 → lit pixels at centre, weight 1 → background.
      const geometry = new Geometry3D({
        positions: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2.5, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        morphTargets: [{ positions: new Float32Array([50, 0, 0, 50, 0, 0, 50, 0, 0]) }],
      });
      const mesh = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5, doubleSided: true }),
        castShadow: false,
        receiveShadow: false,
      });
      view3d.root.addChild(mesh);

      app.render();
      const basePose = readCenter(app);
      // Sanity: the triangle is on screen and lit at weight 0.
      expect(basePose[1]).toBeGreaterThan(20);

      mesh.weights![0] = 1;
      app.render();
      // Extra frame in case a cached list lags by one.
      app.render();

      // The CPU side of the store must have diffed the new weight in.
      const pipe = app.renderer.renderPipes.view3d;
      const store = pipe._morphStoreBuffer;
      expect(store.data[mesh.morph!._weightIndex]).toBe(1);

      // And the GPU must have seen it: the triangle moved off-screen.
      const morphed = readCenter(app);
      expect(morphed[1]).toBeLessThan(10);
    } finally {
      app.destroy();
    }
  });

  it('morphs a scene mesh whose geometry is NOT the first one registered', async () => {
    // A non-morph model renders first, claiming geometry-store row 0, so the morph
    // model lands on a NON-zero row. Pins that the shader reads its own geometry's
    // morph facts: read row 0's instead and targetCount is 0, which skips the morph
    // loop and silently freezes the mesh in its base pose.
    const app = await getApp<WebGLRenderer>({
      id: 'morph-gl-second-geometry',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });
    try {
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 2.6);

      const light = new DirectionalLight({ color: 0xffffff, intensity: 9 });
      light.rotation.set(0.18, 0.12, 0);
      view3d.root.addChild(light);

      // A plain (non-morph) mesh renders first, claiming geometry index 0.
      const plain = new Mesh3D({
        geometry: new Geometry3D({
          positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
        }),
        material: new Material3D({ baseColor: 0x884422, doubleSided: true }),
        castShadow: false,
        receiveShadow: false,
      });
      view3d.root.addChild(plain);
      app.render();
      app.render();
      view3d.root.removeChild(plain);

      // Now the morph mesh — its geometry registers at a non-zero index.
      const geometry = new Geometry3D({
        positions: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2.5, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        morphTargets: [{ positions: new Float32Array([50, 0, 0, 50, 0, 0, 50, 0, 0]) }],
      });
      const mesh = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5, doubleSided: true }),
        castShadow: false,
        receiveShadow: false,
      });
      view3d.root.addChild(mesh);

      app.render();
      // The morph geometry must NOT be index 0, or the bug can't manifest.
      expect(mesh.geometry._geometryDataIndex).toBeGreaterThan(0);
      expect(readCenter(app)[1]).toBeGreaterThan(20); // lit at weight 0

      mesh.weights![0] = 1;
      app.render();
      app.render();

      // The morph must apply: the triangle is shoved off-screen at weight 1.
      expect(readCenter(app)[1]).toBeLessThan(10);
    } finally {
      app.destroy();
    }
  });

  it('animates the AnimatedMorphCube when the clip advances between frames', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'morph-gl-live-gltf',
      appOptions: { preference: 'webgl', width: 128, height: 128, backgroundColor: 0x1e2024 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(2.4, 1.8, 2.8);
      view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

      const key = new DirectionalLight({ color: 0xffffff, intensity: 7 });
      key.rotation.set(-0.7, 0.6, 0);
      view3d.root.addChild(key);

      // Empty frames first: both data textures are created before the model
      // exists, like an app whose glb arrives over the network.
      app.render();
      app.render();

      await Assets.load('AnimatedMorphCube.glb');
      const source = Assets.get<Scene3DSource>('AnimatedMorphCube.glb');
      const model = new Model3D({ source, autoUpdate: false });
      view3d.root.addChild(model);

      const state = model.player!.getState(model.player!.animationLabels[0]);
      state.gotoAndStop(0);

      app.render();
      const atRest = readFrame(app);

      // Advance to mid-clip — this drives `mesh.weights` through the
      // FloatArrayBinding, the same path a live ticker uses.
      state.gotoAndStop(state.animation.duration * 0.4);
      app.render();
      app.render();
      const deformed = readFrame(app);

      expect(countDifferingPixels(atRest, deformed)).toBeGreaterThan(50);
    } finally {
      app.destroy();
      Assets.reset();
    }
  });
});
