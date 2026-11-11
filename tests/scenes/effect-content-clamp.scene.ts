import type { TestScene } from '@test-utils';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { FullscreenPass } from '~/post-processing/effects/FullscreenPass';
import { PostEffect } from '~/post-processing/effects/PostEffect';
import type { EffectIO } from '~/post-processing/effects/PostEffect';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const bandsBit: ShaderBit = {
  name: 'contentClampBands',
  gpu: {
    fragment: {
      material: /* wgsl */ `
    let p = input.vUV;
    let g = abs(fract(p * 5.0) - 0.5);
    let grid = 1.0 - smoothstep(0.0, 0.09, min(g.x, g.y));
    albedo = vec3<f32>(0.08, 0.10, 0.16) + vec3<f32>(0.22, 0.26, 0.34) * grid;
    // A hard band of its own hue along each edge: what the outer sixth replicates.
    albedo = mix(albedo, vec3<f32>(1.0, 0.15, 0.25), 1.0 - smoothstep(0.0, 0.07, p.x));
    albedo = mix(albedo, vec3<f32>(0.15, 1.0, 0.35), smoothstep(0.93, 1.0, p.x));
    albedo = mix(albedo, vec3<f32>(0.25, 0.5, 1.0), 1.0 - smoothstep(0.0, 0.09, p.y));
    albedo = mix(albedo, vec3<f32>(1.0, 0.9, 0.15), smoothstep(0.91, 1.0, p.y));
  `,
    },
  },
  gl: {
    fragment: {
      material: /* glsl */ `
    vec2 p = vUV;
    vec2 g = abs(fract(p * 5.0) - 0.5);
    float grid = 1.0 - smoothstep(0.0, 0.09, min(g.x, g.y));
    albedo = vec3(0.08, 0.10, 0.16) + vec3(0.22, 0.26, 0.34) * grid;
    // A hard band of its own hue along each edge: what the outer sixth replicates.
    albedo = mix(albedo, vec3(1.0, 0.15, 0.25), 1.0 - smoothstep(0.0, 0.07, p.x));
    albedo = mix(albedo, vec3(0.15, 1.0, 0.35), smoothstep(0.93, 1.0, p.x));
    albedo = mix(albedo, vec3(0.25, 0.5, 1.0), 1.0 - smoothstep(0.0, 0.09, p.y));
    albedo = mix(albedo, vec3(1.0, 0.9, 0.15), smoothstep(0.91, 1.0, p.y));
  `,
    },
  },
};

const ZOOM_OUT = {
  gpu: 'fn effect(uv: vec2<f32>) -> vec4<f32> { return sampleColor((uv - 0.5) * 1.5 + 0.5); }',
  gl: 'vec4 effect(vec2 uv) { return sampleColor((uv - 0.5) * 1.5 + 0.5); }',
};

class ZoomOutEffect extends PostEffect {
  public override build(graph: RenderGraph, io: EffectIO): void {
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'contentClamp',
        fragment: ZOOM_OUT,
        reads: { color: io.input },
        writes: io.output,
      }),
    );
  }
}

export const scene: TestScene = {
  app: {
    width: 320,
    height: 240,
    backgroundColor: 0x101418,
  },
  create: async (app) => {
    const view = new View3D({ width: 160, height: 120, passes: [new ZoomOutEffect()] });
    view.position.set(80, 60);
    view.camera.fov = 45;
    view.camera.position.z = 5;
    view.camera.lookAt({ x: 0, y: 0, z: 0 });
    const height = 2 * 5 * Math.tan((45 * Math.PI) / 360);
    view.root.addChild(
      new Mesh3D({
        geometry: new PlaneGeometry({ width: (height * 160) / 120, height }),
        material: new FlatMaterial({ extraBits: [bandsBit] }),
      }),
    );
    app.stage.addChild(view);
  },
};
