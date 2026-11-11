import type { Container } from 'pixi.js';
import { Application, Graphics } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import '~/core/gpu/init';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { traceGpu } from './gpu-inspector';

const CUBE_COLORS = [0xff5566, 0x66ccff, 0x88ffcc, 0xffc857, 0xa8c8ff, 0xff88cc];

function addCubeView(parent: Container, cx: number, cy: number, size: number, color: number): void {
  const view3d = new View3D({ width: size, height: size, anchor: 0.5 });
  view3d.position.set(cx, cy);
  parent.addChild(view3d);

  view3d.camera.fov = 35;
  view3d.camera.position.set(2.2, 1.8, 3.2);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.4 }));
  const key = new DirectionalLight({ color: 0xfff4e0, intensity: 3 });
  key.position.set(4, 5, 6);
  key.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(key);

  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: color, metallic: 0.1, roughness: 0.45 }),
    castShadow: false,
    receiveShadow: false,
  });
  cube.rotation.set(-0.5, 0.7, 0);
  view3d.root.addChild(cube);
}

async function countRenderPassBegins(cubeCount: number): Promise<number> {
  const app = new Application();
  await app.init({ width: 480, height: 180, preference: 'webgpu', autoStart: false, backgroundColor: 0x10202a });
  document.body.appendChild(app.canvas);

  const w = app.screen.width;
  const h = app.screen.height;

  const backdrop = new Graphics();
  for (let gx = 0; gx <= w; gx += 24) backdrop.moveTo(gx, 0).lineTo(gx, h);
  for (let gy = 0; gy <= h; gy += 24) backdrop.moveTo(0, gy).lineTo(w, gy);
  backdrop.stroke({ color: 0x2e6c8c, width: 1.5 });
  app.stage.addChild(backdrop);

  for (let i = 0; i < cubeCount; i++) {
    const cx = ((i + 1) * w) / (cubeCount + 1);
    addCubeView(app.stage, cx, h / 2, 90, CUBE_COLORS[i % CUBE_COLORS.length]);
    if (i < cubeCount - 1) {
      const nextCx = ((i + 2) * w) / (cubeCount + 1);
      const rect = new Graphics().roundRect((cx + nextCx) / 2 - 8, h / 2 - 20, 16, 40, 4).fill({ color: 0xffffff });
      app.stage.addChild(rect);
    }
  }

  app.render();
  app.render();

  const device = (app.renderer as unknown as { gpu: { device: unknown } }).gpu.device;
  const { renderPasses } = traceGpu(device, () => app.render());

  app.canvas.remove();
  app.destroy();
  return renderPasses;
}

describe('keep-encoder-open weave (WebGPU), which pixel tests cannot see', () => {
  test('View3D insets and the 2D between them draw into one open render pass, whatever the View3D count', async () => {
    const two = await countRenderPassBegins(2);
    const four = await countRenderPassBegins(4);

    expect(four, 'a broken weave begins a pass per View3D').toBe(two);
  });
});
