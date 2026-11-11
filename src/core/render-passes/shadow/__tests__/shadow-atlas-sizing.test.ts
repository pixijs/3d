import { getApp } from '@test-utils';
import type { Application } from 'pixi.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

interface ShadowPassProbe {
  renderTarget: { depthStencilTexture: { source: { arrayLayerCount: number } } };
  targetVersion: number;
}

let app: Application;
let view3d: View3D;

const probe = (): ShadowPassProbe => view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassProbe;
const layers = (): number => probe().renderTarget.depthStencilTexture.source.arrayLayerCount;

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    app.render();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
}

function sun(cascades: 1 | 2 | 3 | 4): DirectionalLight {
  const light = new DirectionalLight({
    color: 0xffffff,
    intensity: 4,
    castShadow: true,
    shadow: { cascades, maxDistance: 90 },
  });
  light.position.set(40, 60, 40);
  light.lookAt({ x: 0, y: 0, z: 0 });

  return light;
}

describe('shadow atlas sizing, which the pass base shares between backends, so WebGL covers it in CI', () => {
  beforeAll(async () => {
    app = await getApp({ id: 'shadow-atlas-sizing', appOptions: { preference: 'webgl' } });

    view3d = new View3D({ width: 128, height: 128, shadowQuality: 'low' });
    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 60, height: 60 }),
      material: new Material3D({ baseColor: 0xbbbbbb }),
      castShadow: false,
    });
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 4, height: 8, depth: 4 }),
      material: new Material3D({ baseColor: 0x4a7c59 }),
      castShadow: true,
    });
    cube.position.set(0, 4, 0);
    view3d.root.addChild(cube);
  });

  afterAll(() => {
    app.destroy(true, true);
  });

  it('allocates only the layers the scene claims', async () => {
    view3d.root.addChild(sun(3));
    await settle();
    await settle();

    expect(view3d._shadowDataList.count).toBe(3);
    expect(layers()).toBe(3);
  });

  it('grows when a light asks for more cascades', async () => {
    const before = probe().targetVersion;
    (view3d.root.children.find((c) => c instanceof DirectionalLight) as DirectionalLight).shadow.cascades = 4;
    await settle();

    expect(layers()).toBe(4);
    expect(probe().targetVersion).toBeGreaterThan(before);
  });

  it('grows when a second caster appears', async () => {
    view3d.root.addChild(sun(4));
    await settle();

    expect(view3d._shadowDataList.count).toBe(8);
    expect(layers()).toBe(8);
  });

  it('keeps the high-water mark when a caster goes away', async () => {
    const lights = view3d.root.children.filter((c) => c instanceof DirectionalLight);
    const before = probe().targetVersion;
    view3d.root.removeChild(lights[lights.length - 1]);
    await settle();

    expect(view3d._shadowDataList.count).toBe(4);
    expect(layers()).toBe(8);
    expect(probe().targetVersion).toBe(before);
  });

  it('keeps the layer count across a quality change', async () => {
    const before = probe().targetVersion;
    view3d.shadowQuality = 'medium';
    await settle();

    expect(layers()).toBe(8);
    expect(probe().targetVersion).toBeGreaterThan(before);
  });
});
