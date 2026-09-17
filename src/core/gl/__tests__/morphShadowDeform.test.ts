import { getApp } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Shadow-morph: the cast shadow must TRACK the morph, not hold a base pose.
 *
 * Position-independent check. A caster over a floor has one morph target that
 * shoves it (and its shadow) far off-frame at weight 1. We diff the frame
 * weight0→weight1 twice: once with the caster casting a shadow, once with
 * casting off. The delta between those two diffs is the moving shadow's own
 * contribution — non-trivial only if the shadow followed the morph. A base-pose
 * shadow stays put at both weights, so it contributes nothing extra.
 */

function readFrame(app: { renderer: unknown; canvas: HTMLCanvasElement }, gpu: boolean): Uint8Array {
  if (gpu) {
    const c = document.createElement('canvas');
    c.width = app.canvas.width;
    c.height = app.canvas.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(app.canvas, 0, 0);
    return new Uint8Array(ctx.getImageData(0, 0, app.canvas.width, app.canvas.height).data.buffer);
  }
  const gl = (app.renderer as { gl: WebGL2RenderingContext }).gl;
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const out = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

function diffPixels(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) n++;
  }
  return n;
}

async function diffOverMorph(preference: 'webgl' | 'webgpu', casts: boolean): Promise<number> {
  const W = 128;
  const app = await getApp({
    id: `morph-shadow-deform-${preference}-${casts}`,
    appOptions: { preference, width: W, height: W, backgroundColor: 0x101014 },
  });
  try {
    const view3d = new View3D({ width: W, height: W, shadowQuality: 'high' });
    app.stage.addChild(view3d);
    // Top-down-ish camera so the floor (and the long cast shadow) fills the frame.
    view3d.camera.position.set(0, 6, 2.5);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    // Low, side-raking light → a long shadow stretched across the floor.
    const key = new DirectionalLight({ color: 0xffffff, intensity: 6, castShadow: true });
    key.rotation.set(-0.35, 0.0, 0);
    view3d.root.addChild(key);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 60, height: 60 }),
      material: new Material3D({ baseColor: 0xb0b0b0, metallic: 0, roughness: 0.95 }),
      castShadow: false,
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(floor);

    // A wide, tall wall standing on the floor casts a long shadow toward the
    // camera. Its morph target shoves the whole wall +40x at weight 1, so the
    // long shadow sweeps off the framed floor. A base-pose shadow would not move.
    const P = new Float32Array([-2.5, 0, 0, 2.5, 0, 0, 2.5, 3, 0, -2.5, 3, 0]);
    const M = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) M[i] = 40;
    const caster = new Mesh3D({
      geometry: new Geometry3D({
        positions: P,
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        morphTargets: [{ positions: M }],
      }),
      material: new Material3D({ baseColor: 0x4a7c59, doubleSided: true }),
      castShadow: casts,
    });
    view3d.root.addChild(caster);

    caster.weights![0] = 0;
    app.render();
    app.render();
    const f0 = readFrame(app as never, preference === 'webgpu');

    caster.weights![0] = 1;
    app.render();
    app.render();
    const f1 = readFrame(app as never, preference === 'webgpu');

    return diffPixels(f0, f1);
  } finally {
    app.destroy();
  }
}

async function shadowContribution(preference: 'webgl' | 'webgpu'): Promise<number> {
  // Frame change over the morph WITH the caster casting, minus the change with
  // casting off — the remainder is the moving shadow's own contribution.
  const withShadow = await diffOverMorph(preference, true);
  const noShadow = await diffOverMorph(preference, false);
  return withShadow - noShadow;
}

describe('shadow-morph deforms the cast shadow', () => {
  it('WebGL: the shadow moves with the morph', async () => {
    expect(await shadowContribution('webgl')).toBeGreaterThan(150);
  });
  it('WebGPU: the shadow moves with the morph', async () => {
    expect(await shadowContribution('webgpu')).toBeGreaterThan(150);
  });
});
