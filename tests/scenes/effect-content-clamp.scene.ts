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

/**
 * What a sample helper does when it reaches past the content.
 *
 * The view is an inset, so its scene transient rounds up into a pool bucket and the content
 * occupies only a corner of it. The rest of that texture is not blank: the pool recycles by
 * size, so it holds whatever the previous tenant wrote, and a bind clears only the frame.
 *
 * The effect samples a uv range of -0.25 to 1.25, so the outer sixth of every side comes from
 * outside the content rect. Clamped, those bands replicate the content's edge, which is the
 * horizontal and vertical smear this image is of. Unclamped, they show another pass's picture.
 *
 * The pattern runs to all four edges and each edge is a different hue, so a band reading the
 * wrong thing cannot coincidentally match.
 */

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
    // Smaller than the canvas on both axes, so the transient is bucketed and padded.
    const view = new View3D({ width: 160, height: 120, passes: [new ZoomOutEffect()] });
    view.position.set(80, 60);
    view.camera.fov = 45;
    view.camera.position.z = 5;
    view.camera.lookAt({ x: 0, y: 0, z: 0 });
    // Sized to fill the view exactly, so the plane's UV and the transient's content rect are the
    // same square and the bands above sit on the edge the clamp has to replicate.
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
