/**
 * `depth-of-field`: what `DepthOfFieldEffect` costs over the lit field at each `quality`, and whether gathering
 * the low-quality blur at half resolution saves more.
 *
 * - `high`: `quality: 'high'`, 48 taps a pixel at the scene's resolution. First, so `--against` measures a change
 *   to it and every other variant is judged against it.
 * - `low`: `quality: 'low'`, 16 taps.
 * - `low-half`: the low shader into a half-resolution texture, then a full-resolution pass that keeps the sharp
 *   pixel where its blur is under a pixel and takes the half-resolution blur elsewhere. A cost probe: it loses a
 *   blurred foreground's spread over sharp pixels, which a shipped form would have to keep.
 * - `copy`: one pass that only copies the scene, the floor any effect pays. Every variant runs at
 *   `'beforeToneMapping'`, so all draw the same float scene and output pass.
 *
 * The field spans 25 to 55 units from the camera; the focus is at 40, sharp within 3, so most of the frame blurs.
 * Multisampling is off. Judged on `gpu.frame`. The view culls on the CPU (`cull: 'cpu'`) so runs draw one frame.
 */

import { FullscreenPass, Mesh3D } from '@pixi/3d';
import type { EffectFragment, EffectIO, Pass3D, RenderGraph } from '@pixi/3d';
import { DepthOfFieldEffect } from '@pixi/3d/extras';
import { frame } from 'benchy';

import { CopyEffect } from './copy.ts';
import { postScene } from './data/post.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

type Mode = 'high' | 'low' | 'low-half' | 'copy';

const FOCUS = { focusDistance: 40, focusRange: 3, focusFalloff: 3, maxBlur: 16 };

/** Keeps the sharp pixel where its own blur is under a pixel and takes the half-resolution blur elsewhere */
const COMBINE: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let range = fx.uDof.y;
  let t = clamp((abs(linearDepth(sampleDepth(uv)) - fx.uDof.x) - range) / max(fx.uDof.z, 0.0001), 0.0, 1.0);
  let r = t * t * (3.0 - 2.0 * t) * fx.uDof.w;
  return mix(sampleColor(uv), sampleColor2(uv), clamp(r - 0.5, 0.0, 1.0));
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  float range = uDof.y;
  float t = clamp((abs(linearDepth(sampleDepth(uv)) - uDof.x) - range) / max(uDof.z, 0.0001), 0.0, 1.0);
  float r = t * t * (3.0 - 2.0 * t) * uDof.w;
  return mix(sampleColor(uv), sampleColor2(uv), clamp(r - 0.5, 0.0, 1.0));
}
`,
};

/** The low-quality shader and uniforms, gathered into a half-resolution texture */
class HalfResolutionDepthOfField extends DepthOfFieldEffect {
  constructor() {
    super({ ...FOCUS, quality: 'low' });
  }

  public override build(graph: RenderGraph, io: EffectIO): void {
    const blurred = graph.createColor({ resolution: graph.resolution * 0.5, label: 'dofHalf' });
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'dofHalf:gather',
        fragment: this.fragment,
        uniforms: this.uniforms,
        reads: { color: io.input, depth: graph.sceneDepth },
        writes: blurred,
      }),
    );
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'dofHalf:combine',
        fragment: COMBINE,
        uniforms: this.uniforms,
        reads: { color: io.input, color2: blurred, depth: graph.sceneDepth },
        writes: io.output,
      }),
    );
  }
}

function createEffect(mode: Mode): Pass3D {
  if (mode === 'high' || mode === 'low') return new DepthOfFieldEffect({ ...FOCUS, quality: mode });
  if (mode === 'copy') return new CopyEffect();

  return new HalfResolutionDepthOfField();
}

frame('depth-of-field', {
  variants: {
    high: { mode: 'high' },
    low: { mode: 'low' },
    'low-half': { mode: 'low-half' },
    copy: { mode: 'copy' },
  },
  primary: 'gpu.frame',
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { mode }: { mode: Mode }) {
    const data = postScene();
    applyLook(stage, data.look);
    const { view } = stage;
    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map(toMaterial);
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < data.count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material) throw new Error(`depth-of-field: object ${i} names a missing geometry or material`);
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      meshes.push(view.root.addChild(mesh));
    }

    const effect = createEffect(mode);
    view.passes = [effect];

    const quat = data.quat;
    return {
      simulate(seconds) {
        data.update(seconds);
      },
      update() {
        let at = 0;
        for (const mesh of meshes) {
          mesh.quaternion.fromArray(quat, at);
          at += 4;
        }
      },
      destroy() {
        effect.destroy();
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy();
      },
    };
  },
});
