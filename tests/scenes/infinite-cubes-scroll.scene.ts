import type { TestScene } from '@test-utils';
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Renderer } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// Static frame of the `infinite-cubes-scroll` example at a fixed scroll value, on a non-square window:
// verifies the conveyor + presenter assembles (fills the window, true cubes, no black, no reparenting).
const T = 1024;
const FOV = 50;
const CUBE = 2;
const N = 7;
const REST = 5;
const SCROLL = 3.7; // topId 3, f 0.7 (top mostly zoomed out)

const fillDistance = (): number => CUBE / 2 + CUBE / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const colour = (id: number): string => `hsl(${(((id * 40) % 360) + 360) % 360}, 78%, 48%)`;
const poseX = (id: number): number => -0.4 + 0.3 * Math.sin(id * 1.7);
const poseY = (id: number): number => 0.5 + 0.4 * Math.cos(id * 1.1);

export const scene: TestScene = {
  app: { backgroundColor: 0x05060c, width: 768, height: 432 },
  create: async (app) => {
    const renderer = app.renderer as unknown as Renderer;

    interface Engine {
      texture: ContainerTexture;
      bg: Graphics;
      view: View3D;
      cube: Mesh3D;
      label: Text;
    }

    const buildEngine = (sample: ContainerTexture): Engine => {
      const container = new Container();
      const bg = new Graphics();
      const view = new View3D({ width: T, height: T });
      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: CUBE, height: CUBE, depth: CUBE }),
        material: new FlatMaterial({
          baseColor: 'white',
          baseColorTexture: sample,
        }),
        castShadow: false,
        receiveShadow: false,
      });
      view.root.addChild(cube);
      view.camera.fov = FOV;
      view.camera.position.set(0, 0, REST);
      const label = new Text({
        text: '',
        style: { fill: 0xffffff, fontSize: 64, fontWeight: 'bold', stroke: { color: 0x000000, width: 8 } },
      });
      label.anchor.set(0.5, 0);
      label.position.set(T / 2, T * 0.26);
      container.addChild(bg, view, label);
      const texture = new ContainerTexture({
        container,
        width: T,
        height: T,
        resolution: 1,
      });
      return { texture, bg, view, cube, label };
    };

    const floorRect = new Graphics();
    const floorHolder = new Container();
    floorHolder.addChild(floorRect);
    const floorTex = new ContainerTexture({
      container: floorHolder,
      width: T,
      height: T,
      resolution: 1,
    });

    const engines: Engine[] = [];
    let below: ContainerTexture = floorTex;
    for (let k = 0; k < N; k++) {
      const engine = buildEngine(below);
      engines.push(engine);
      below = engine.texture;
    }

    // Assemble the window for SCROLL.
    const topId = Math.floor(SCROLL);
    const f = SCROLL - topId;
    const fill = fillDistance();
    const deepestId = topId - (N - 1);

    floorRect
      .clear()
      .rect(0, 0, T, T)
      .fill(colour(deepestId - 1));
    for (let k = 0; k < N; k++) {
      const id = deepestId + k;
      const engine = engines[k];
      engine.bg.clear().rect(0, 0, T, T).fill(colour(id));
      engine.label.text = `LAYER ${id}`;
      if (k === N - 1) {
        engine.view.camera.position.z = lerp(fill, REST, f);
        engine.cube.rotation.set(poseX(id) * f, poseY(id) * f, 0);
      } else {
        engine.view.camera.position.z = REST;
        engine.cube.rotation.set(poseX(id), poseY(id), 0);
      }
    }

    // The ContainerTexture is stored screen-oriented (flipY:true, for 3D), so a 2D Sprite presenting it
    // must flip it back vertically (negative Y scale, positioned from the bottom edge).
    const presenter = new Sprite(engines[N - 1].texture);
    const fit = Math.max(app.screen.width, app.screen.height) / T;
    presenter.scale.set(fit, -fit);
    const left = (app.screen.width - T * fit) / 2;
    const top = (app.screen.height - T * fit) / 2;
    presenter.position.set(left, top + T * fit);
    app.stage.addChild(presenter);

    // Render the chain deepest-first (a couple of passes so the nesting settles) before the screenshot.
    for (let pass = 0; pass < 2; pass++) {
      floorTex.render(renderer);
      for (const engine of engines) engine.texture.render(renderer);
    }
  },
};
