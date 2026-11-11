import type { TestScene } from '@test-utils';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { DepthClearPass } from '~/core/render-passes/depth-clear/DepthClearPass';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { BloomEffect } from '~/extras/post-processing/effects/BloomEffect';
import { FxaaEffect } from '~/extras/post-processing/effects/FxaaEffect';
import { TiltShiftEffect } from '~/extras/post-processing/effects/TiltShiftEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { PointLight } from '~/scene/lights/PointLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const WIDTH = 512;
const HEIGHT = 256;
const EYE_Z = 10;
const WALL_Z = -8;
const LIGHT_Z = WALL_Z + 1.5;
const FOV = 75;
const EDGE = Math.tan((FOV * Math.PI) / 360) * (EYE_Z - LIGHT_Z);
const GRID_COLORS = [0xff5a4d, 0xffc53d, 0x7be36a, 0x3dd6ff, 0xffffff, 0x6f7cff, 0xd96bff, 0xff7ab8, 0x63ffd1];

class InsetPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'afterTransparent';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const { renderer } = ctx;
    const camera = this._camera;

    graph.addPass(new DepthClearPass({ renderer, camera }));
    graph.addPass(new ForwardRenderPass({ renderer, name: 'opaque', sort: 'key', camera }));
    graph.addPass(new ForwardRenderPass({ renderer, name: 'transparent', sort: 'distance', camera }));
  }
}

function litWallView(): View3D {
  const inset = new Camera3D({ mode: 'orthographic', orthographicSize: EDGE, near: 1, far: 60 });
  inset.position.set(0, 0, EYE_Z);
  inset.viewport.x = 0.6;
  inset.viewport.y = 0.05;
  inset.viewport.width = 0.26;
  inset.viewport.height = 0.3;

  const view = new View3D({ width: WIDTH, height: HEIGHT, resolution: 0.75, passes: [new InsetPass(inset)] });
  view.camera.fov = FOV;
  view.camera.near = 0.15;
  view.camera.far = 120;
  view.camera.position.set(0, 0, EYE_Z);
  view.root.addChild(inset, new AmbientLight({ intensity: 0.15 }));

  const wall = new Mesh3D({
    geometry: new PlaneGeometry({ width: 120, height: 80 }),
    material: new Material3D({ baseColor: 0xb8b8b8, metallic: 0, roughness: 0.6 }),
    castShadow: false,
    receiveShadow: false,
  });
  wall.position.set(0, 0, WALL_Z);
  view.root.addChild(wall);

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const light = new PointLight({ color: GRID_COLORS[row * 3 + column], intensity: 400, range: 5 });
      light.position.set((column - 1) * EDGE * 2, (row - 1) * EDGE, LIGHT_Z);
      view.root.addChild(light);
    }
  }

  const glass = new Mesh3D({
    geometry: new CubeGeometry({ width: 3, height: 3, depth: 3 }),
    material: new Material3D({
      baseColor: 0xffffff,
      metallic: 0,
      roughness: 0.05,
      transmission: { factor: 1, thickness: 0.5 },
      ior: 1.5,
    }),
    castShadow: false,
    receiveShadow: false,
  });
  glass.rotation.set(-0.5, 0.7, 0);
  glass.position.set(-2, -1, 0);
  view.root.addChild(glass);

  return view;
}

function staircaseView(): View3D {
  const view = new View3D({
    width: WIDTH,
    height: HEIGHT,
    resolution: 0.625,
    toneMapping: 'none',
    environment: { skyColor: 0x8899aa, groundColor: 0x223344 },
    passes: [
      new TiltShiftEffect({ focalDepth: 8.2, focalNear: 0.9, focalFar: 2.4, maxBlur: 10 }),
      new BloomEffect({ threshold: 1.1, intensity: 5, radius: 0.7 }),
      new FxaaEffect(),
    ],
  });
  view.position.set(0, HEIGHT);
  view.camera.fov = 35;
  view.camera.position.set(0, 2.5, 7);
  view.camera.lookAt({ x: 0, y: 0.5, z: 0 });
  view.root.addChild(new AmbientLight({ intensity: 0.3 }));

  const colors = [0xffffff, 0xffffff, 0x52c06a, 0x5290e0, 0xffffff, 0xffffff];
  for (let i = 0; i < colors.length; i++) {
    const box = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0x000000, emissive: { color: colors[i], strength: 1 } }),
    });
    box.position.set((i % 2 === 0 ? -0.7 : 0.7) * (1 + i * 0.12), 0.5, 3 - i * 1.6);
    view.root.addChild(box);
  }

  const sphere = new Mesh3D({
    geometry: new SphereGeometry({ radius: 0.45 }),
    material: new Material3D({ baseColor: 0x202020, roughness: 0.6, emissive: { color: 0x66ff88, strength: 2 } }),
  });
  sphere.position.set(2.6, 0.5, -1);
  view.root.addChild(sphere);

  const floor = new Mesh3D({
    geometry: new PlaneGeometry({ width: 30, height: 30 }),
    material: new Material3D({ baseColor: 0x050608, roughness: 0.95 }),
  });
  floor.rotation.set(-Math.PI / 2, 0, 0);
  view.root.addChild(floor);

  return view;
}

export const scene: TestScene = {
  app: { backgroundColor: 0x05060a },
  delay: 120,
  create: async (app) => {
    app.stage.addChild(litWallView(), staircaseView());
  },
};
