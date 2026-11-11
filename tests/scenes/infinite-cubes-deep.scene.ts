import type { TestScene } from '@test-utils';
import { Container, Graphics, Text } from 'pixi.js';
import type { Texture } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const T = 1024;
const LIVE = 6;
const REST = 5;

export const scene: TestScene = {
  app: { backgroundColor: 0x05060c, width: 768, height: 432 },
  create: async (app) => {
    const renderer = app.renderer;

    interface Layer {
      container: Container;
      view: View3D;
      cube: Mesh3D;
      capture: ContainerTexture | null;
    }

    const build = (level: number, material: BaseMaterial3D, lit: boolean, sample: ContainerTexture | null): Layer => {
      const container = new Container();
      container.addChild(new Graphics().rect(0, 0, T, T).fill(`hsl(${(level * 40) % 360}, 78%, 48%)`));
      const view = new View3D({ width: T, height: T });
      if (lit) {
        const key = new DirectionalLight({ color: 0xffffff, intensity: 6 });
        key.rotation.set(-0.6, 0.6, 0);
        view.root.addChild(key);
      }
      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
        material,
        castShadow: false,
        receiveShadow: false,
      });
      cube.rotation.set(-0.4, 0.6, 0);
      view.root.addChild(cube);
      view.camera.fov = 50;
      view.camera.position.set(0, 0, REST);
      if (sample) (cube.material.textures as { baseColor: Texture }).baseColor = sample;
      const label = new Text({
        text: `LAYER ${level}`,
        style: { fill: 0xffffff, fontSize: 80, fontWeight: 'bold', stroke: { color: 0x000000, width: 8 } },
      });
      label.anchor.set(0.5, 0);
      label.position.set(T / 2, T * 0.26);
      container.addChild(view, label);
      return { container, view, cube, capture: null };
    };

    const display = (layer: Layer): void => {
      const fit = Math.max(app.screen.width, app.screen.height) / T;
      layer.container.scale.set(fit);
      layer.container.position.set((app.screen.width - T * fit) / 2, (app.screen.height - T * fit) / 2);
    };

    const chain: Layer[] = [];
    const texturePool: ContainerTexture[] = [];
    let frozenFloor: ContainerTexture | null = null;
    let depth = 0;

    const renderFrame = (): void => {
      for (const layer of chain) layer.capture?.render(renderer);
    };

    const push = (): void => {
      const inner = chain[chain.length - 1];
      inner.container.scale.set(1);
      inner.container.position.set(0, 0);

      let tex = texturePool.pop();
      if (tex) tex.setContainer(inner.container);
      else
        tex = new ContainerTexture({
          container: inner.container,
          width: T,
          height: T,
          resolution: 1,
        });
      inner.capture = tex;

      depth++;
      const top = build(depth, new FlatMaterial({ baseColor: 'white' }), false, tex);
      app.stage.addChild(top.container);
      display(top);
      chain.push(top);

      while (chain.length > LIVE) {
        const dead = chain.shift()!;
        if (frozenFloor) texturePool.push(frozenFloor);
        frozenFloor = dead.capture;
        dead.container.destroy({ children: true });
      }
    };

    const base = build(0, new Material3D({ baseColor: 0xff7a33, metallic: 0.1, roughness: 0.45 }), true, null);
    app.stage.addChild(base.container);
    display(base);
    chain.push(base);

    renderFrame();
    for (let i = 0; i < 11; i++) {
      push();
      for (let f = 0; f < 3; f++) renderFrame();
    }
  },
};
