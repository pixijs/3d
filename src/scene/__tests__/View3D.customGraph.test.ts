import { captureWarnings, expectCleanRender, getApp } from '@test-utils';
import { RenderTexture } from 'pixi.js';
import type { Application, Renderer, WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderGraph } from '~/core/render-graph/RenderGraph';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { solidMeshDescriptor } from '~/extras/post-processing/passes/solidMeshShader';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { FullscreenPass } from '~/post-processing/effects/FullscreenPass';
import type { EffectFragment } from '~/post-processing/effects/PostEffect';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { createDefaultGraph3D } from '~/scene/utils/createDefaultGraph3D';
import { View3D } from '~/scene/View3D';

const WIDTH = 200;
const HEIGHT = 160;

const GREEN_COPY: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  return vec4<f32>(0.0, sampleColor(uv).g, 0.0, 1.0);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  return vec4(0.0, sampleColor(uv).g, 0.0, 1.0);
}
`,
};

function glass(): Mesh3D {
  const mesh = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 0.2 }),
    material: new Material3D({ transmission: { factor: 1, thickness: 0.5 }, ior: 1.5, roughness: 0.6 }),
  });
  mesh.position.set(0, 0, 1.5);
  return mesh;
}

function customView(onBuild: () => void): View3D {
  const view3d = new View3D({
    width: WIDTH,
    height: HEIGHT,
    composite: true,
    environment: { skyColor: 0xffffff, groundColor: 0x223344 },
    graph: (renderer, options) => {
      onBuild();
      const { graph, handles } = createDefaultGraph3D(renderer, options);
      graph.addPass(
        new FullscreenPass({
          renderer,
          label: 'greenCopy',
          fragment: GREEN_COPY,
          reads: { color: handles.opaqueColor },
          writes: null,
        }),
      );
      return graph;
    },
  });
  view3d.camera.position.set(0, 1.4, 4);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.35 }));
  view3d.root.addChild(
    new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.9 }),
      material: new Material3D({ baseColor: 0x77aaff, roughness: 0.35, metallic: 0 }),
    }),
  );
  view3d.root.addChild(glass());
  return view3d;
}

function centre(app: Application<Renderer>, view3d: View3D): number[] {
  const { pixels, width, height } = app.renderer.extract.pixels(view3d);
  const i = ((height >> 1) * width + (width >> 1)) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

function expectGreenOnly([r, g, b]: number[], message: string): void {
  expect(r, message).toBeLessThan(8);
  expect(b, message).toBeLessThan(8);
  expect(g, message).toBeGreaterThan(32);
}

function destroyedWhileBound(warnings: string[]): string[] {
  return warnings.filter((w) => w.includes('destroyed while still bound'));
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`custom graph with a pass-owned texture binding (${preference})`, () => {
    it('draws through its own binding, again after unload() rebuilds the graph, and after a resize evicts its input', async () => {
      const app = await getApp<Renderer>({
        id: `custom-graph-binding-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true, backgroundColor: 0x242c36 },
      });
      let builds = 0;
      const view3d = customView(() => builds++);
      try {
        app.stage.addChild(view3d);
        await expectCleanRender(app);
        await expectCleanRender(app);
        expect(builds, 'one build for the first render').toBe(1);
        expectGreenOnly(centre(app, view3d), 'the custom pass presents the opaque copy through its own binding');

        const unloadWarnings = captureWarnings(() => view3d.unload());
        expect(destroyedWhileBound(unloadWarnings)).toEqual([]);

        await expectCleanRender(app);
        expect(builds, 'the next render runs the builder again').toBe(2);
        expectGreenOnly(centre(app, view3d), 'the rebuilt graph draws the same way');

        const resizeWarnings = captureWarnings(() => app.renderer.resize(WIDTH + 40, HEIGHT + 40));
        expect(
          destroyedWhileBound(resizeWarnings),
          'the graph put the placeholder back in the pass-owned slot before the pool destroyed its input',
        ).toEqual([]);

        await expectCleanRender(app);
        expectGreenOnly(centre(app, view3d), 'the frame after the resize samples a fresh copy');
      } finally {
        view3d.destroy({ children: true });
        app.destroy(true);
      }
    });
  });

  describe(`a graph built from one forward pass (${preference})`, () => {
    async function bareGraphScene(): Promise<{
      app: Application<Renderer>;
      view3d: View3D;
      texture: RenderTexture;
      graph: () => RenderGraph;
    }> {
      const app = await getApp<Renderer>({
        id: `bare-graph-${preference}`,
        appOptions: { preference, width: 16, height: 16, resolution: 1, autoStart: false },
      });
      const texture = RenderTexture.create({ width: 16, height: 16 });
      const camera = new Camera3D({ renderTexture: texture });
      camera.position.set(0, 0, 5);
      let built: RenderGraph | null = null;
      const view3d = new View3D({
        width: 16,
        height: 16,
        environment: { skyColor: 0xffffff, groundColor: 0x223344 },
        graph: (renderer, options) => {
          built = new RenderGraph({
            globalTextureBindings: options.globalTextureBindings,
            defaultColor: (session) => session.defaultTarget.colorTexture,
            defaultDepth: (session) => session.defaultTarget.depthStencilTexture!,
          });
          built.addPass(
            new ForwardRenderPass({
              renderer,
              name: 'opaque',
              bit: RenderPassBit.OPAQUE,
              sort: 'key',
              camera,
              descriptor: { shaderDescriptor: solidMeshDescriptor({ color: 0xff0000 }) },
            }),
          );
          built.compile();
          return built;
        },
      });
      const sun = new DirectionalLight({ intensity: 3, castShadow: true, shadow: { cascades: 3 } });
      sun.position.set(2, 4, 3);
      view3d.root.addChild(camera, sun);
      view3d.root.addChild(
        new Mesh3D({ geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }), material: new Material3D() }),
      );
      app.stage.addChild(view3d);
      return { app, view3d, texture, graph: () => built! };
    }

    it("holds only its own pass, and fills the camera's texture with that pass's draw", async () => {
      const { app, view3d, texture, graph } = await bareGraphScene();

      await expectCleanRender(app);

      expect(graph().passes.map((pass) => pass.name)).toEqual(['opaque']);
      const { pixels } = app.renderer.extract.pixels({ target: texture });
      const i = (8 * 16 + 8) * 4;
      expect([pixels[i], pixels[i + 1], pixels[i + 2]]).toEqual([255, 0, 0]);

      view3d.destroy(true);
      texture.destroy(true);
      app.destroy();
    });

    it.runIf(preference === 'webgl')(
      'draws the meshes once a frame, with no shadow, background or lit draw',
      async () => {
        const { app, view3d, texture } = await bareGraphScene();
        await expectCleanRender(app);

        const gl = (app.renderer as WebGLRenderer).gl;
        const drawElements = gl.drawElements.bind(gl);
        const drawArrays = gl.drawArrays.bind(gl);
        let draws = 0;
        gl.drawElements = (...args) => {
          draws++;
          drawElements(...args);
        };
        gl.drawArrays = (...args) => {
          draws++;
          drawArrays(...args);
        };
        app.render();
        gl.drawElements = drawElements;
        gl.drawArrays = drawArrays;

        expect(draws).toBe(1);

        view3d.destroy(true);
        texture.destroy(true);
        app.destroy();
      },
    );
  });

  describe(`an opaque pass with a shader of its own (${preference})`, () => {
    it("draws each mesh with the pass's shader, which binds no material, also after the mesh rebuilds", async () => {
      const app = await getApp<Renderer>({
        id: `own-shader-pass-${preference}`,
        appOptions: { preference, width: 16, height: 16, resolution: 1, autoStart: false },
      });
      const texture = RenderTexture.create({ width: 16, height: 16 });
      const camera = new Camera3D({ renderTexture: texture });
      camera.position.set(0, 0, 5);
      const view3d = new View3D({
        width: 16,
        height: 16,
        graph: (renderer, options) => {
          const graph = new RenderGraph({
            globalTextureBindings: options.globalTextureBindings,
            defaultColor: (session) => session.defaultTarget.colorTexture,
            defaultDepth: (session) => session.defaultTarget.depthStencilTexture!,
          });
          graph.addPass(
            new ForwardRenderPass({
              renderer,
              name: 'opaque',
              bit: RenderPassBit.OPAQUE,
              sort: 'key',
              camera,
              descriptor: { shaderDescriptor: solidMeshDescriptor({ color: 0xff0000 }) },
            }),
          );
          graph.compile();
          return graph;
        },
      });
      view3d.root.addChild(camera);
      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
        material: new Material3D(),
      });
      view3d.root.addChild(cube);
      try {
        app.stage.addChild(view3d);
        await expectCleanRender(app);

        const { pixels } = app.renderer.extract.pixels({ target: texture });
        const i = (8 * 16 + 8) * 4;
        expect([pixels[i], pixels[i + 1], pixels[i + 2]]).toEqual([255, 0, 0]);

        view3d.root.removeChild(cube);
        view3d.root.addChild(cube);
        await expectCleanRender(app);

        const again = app.renderer.extract.pixels({ target: texture }).pixels;
        expect([again[i], again[i + 1], again[i + 2]]).toEqual([255, 0, 0]);
      } finally {
        view3d.destroy({ children: true });
        texture.destroy(true);
        app.destroy(true);
      }
    });
  });
}
