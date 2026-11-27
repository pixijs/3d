/**
 * `depth-of-field`: what `DepthOfFieldEffect` costs over the lit field at each `quality`, and what gathering the
 * low-quality blur at half resolution saves.
 *
 * - `high`: `quality: 'high'`, 48 taps a pixel at the scene's resolution. First, so `--against` measures a change
 *   to it and every other variant is judged against it.
 * - `low`: `quality: 'low'` as it ships, 16 taps at half the screen's resolution and a merge back to full size.
 * - `low-full`: the same 16-tap blur in one pass at the scene's resolution, without the half-resolution texture or
 *   the merge.
 * - `copy`: one pass that only copies the scene, the floor any effect pays. Every variant runs at
 *   `'beforeToneMapping'`, so all draw the same float scene and output pass.
 *
 * The field spans 25 to 55 units from the camera; the focus is at 40, sharp within 3, so most of the frame blurs.
 * Multisampling is off. Judged on `gpu.frame`. The view culls on the CPU (`cull: 'cpu'`) so runs draw one frame.
 */

import { FullscreenPass, Mesh3D } from '@pixi/3d';
import type { EffectIO, Pass3D, RenderGraph } from '@pixi/3d';
import { DepthOfFieldEffect } from '@pixi/3d/extras';
import { frame } from 'benchy';

import { CopyEffect } from './copy.ts';
import { postScene } from './data/post.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

type Mode = 'high' | 'low' | 'low-full' | 'copy';

const FOCUS = { focusDistance: 40, focusRange: 3, focusFalloff: 3, maxBlur: 16 };

/** The low-quality blur in one pass at the scene's resolution */
class FullResolutionLowDepthOfField extends DepthOfFieldEffect {
  constructor() {
    super({ ...FOCUS, quality: 'low' });
  }

  public override build(graph: RenderGraph, io: EffectIO): void {
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'depthOfField:lowFull',
        fragment: this.fragment,
        uniforms: this.uniforms,
        reads: { color: io.input, depth: graph.sceneDepth },
        writes: io.output,
      }),
    );
  }
}

function createEffect(mode: Mode): Pass3D {
  if (mode === 'high' || mode === 'low') return new DepthOfFieldEffect({ ...FOCUS, quality: mode });
  if (mode === 'copy') return new CopyEffect();

  return new FullResolutionLowDepthOfField();
}

frame('depth-of-field', {
  variants: {
    high: { mode: 'high' },
    low: { mode: 'low' },
    'low-full': { mode: 'low-full' },
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
