import { expectCleanRender, getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { captureGraphDebugSnapshot } from '~/extras/debug/GraphDebugSnapshot';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PostEffect } from '~/post-processing/effects/PostEffect';
import type { EffectFragment } from '~/post-processing/effects/PostEffect';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';
import type { View3DOptions } from '~/scene/View3D';

const WIDTH = 200;
const HEIGHT = 160;

class DepthFogEffect extends PostEffect {
  protected readonly fragment: EffectFragment = {
    gpu: `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  return mix(sampleColor(uv), vec4<f32>(0.5, 0.6, 0.7, 1.0), sampleDepth(uv) * 0.5);
}
`,
    gl: `
vec4 effect(vec2 uv) {
  return mix(sampleColor(uv), vec4(0.5, 0.6, 0.7, 1.0), sampleDepth(uv) * 0.5);
}
`,
  };
}

class DepthTexelStepEffect extends PostEffect {
  protected readonly fragment: EffectFragment = {
    gpu: 'fn effect(uv: vec2<f32>) -> vec4<f32> { return sampleColor(uv + vec2<f32>(depthTexel().x, 0.0)); }',
    gl: 'vec4 effect(vec2 uv) { return sampleColor(uv + vec2(depthTexel().x, 0.0)); }',
  };
}

function view(options: Partial<View3DOptions> = {}): View3D {
  const view3d = new View3D({ width: WIDTH, height: HEIGHT, passes: [new DepthFogEffect()], ...options });
  view3d.camera.position.z = 4;
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0x44aaff }) }));
  return view3d;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a post effect whose fragment calls sampleDepth (${preference})`, () => {
    async function expectCleanFrames(id: string, view3d: View3D): Promise<void> {
      const app = await getApp<Renderer>({
        id: `post-effect-depth-read-${id}-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT },
      });
      try {
        app.stage.addChild(view3d);
        for (let i = 0; i < 3; i++) await expectCleanRender(app);
      } finally {
        app.destroy(true);
      }
    }

    it('declares the scene depth read for a fragment that only calls depthTexel', async () => {
      const app = await getApp<Renderer>({
        id: `post-effect-depth-texel-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT },
      });
      try {
        const view3d = view({ passes: [new DepthTexelStepEffect()] });
        app.stage.addChild(view3d);
        await expectCleanRender(app);

        const graph = view3d._graph;
        const step = captureGraphDebugSnapshot(graph).passes.find((p) => p.name === 'DepthTexelStepEffect')!;
        expect(step.accesses.map((a) => a.handleId)).toContain(graph.sceneDepth._id);
      } finally {
        app.destroy(true);
      }
    });

    it('renders three clean frames with a blended mesh in the scene', async () => {
      const view3d = view();
      const glass = new Mesh3D({
        geometry: new PlaneGeometry({ width: 3, height: 3 }),
        material: new Material3D({ alpha: 0.4, alphaMode: 'blend' }),
      });
      glass.position.set(0, 0, 1);
      view3d.root.addChild(glass);

      await expectCleanFrames('blended', view3d);
    });

    it('renders three clean frames with a hemisphere background', async () => {
      await expectCleanFrames('background', view({ background: { skyColor: 0x223355, groundColor: 0x111111 } }));
    });

    it('renders three clean frames with particles in the scene', async () => {
      const view3d = view();
      const particles = new ParticleSystem3D({ capacity: 16, autoUpdate: false, emitRate: 0, life: 100, size: 0.5 });
      view3d.root.addChild(particles);
      particles.spawn(16);
      particles.update();

      await expectCleanFrames('particles', view3d);
    });
  });
}
