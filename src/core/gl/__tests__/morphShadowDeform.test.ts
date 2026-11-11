import { getApp, readCanvasPixels } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function diffPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
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
    view3d.camera.position.set(0, 6, 2.5);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

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
    const f0 = readCanvasPixels(app.canvas);

    caster.weights![0] = 1;
    app.render();
    app.render();
    const f1 = readCanvasPixels(app.canvas);

    return diffPixels(f0, f1);
  } finally {
    app.destroy();
  }
}

async function shadowContribution(preference: 'webgl' | 'webgpu'): Promise<number> {
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
