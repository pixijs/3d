import type { TestScene } from '@test-utils';
import { CubeTexture, Texture } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { TorusGeometry } from '~/geometry/TorusGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const FACE_COLORS = ['#ff7777', '#77ff77', '#9bb4d8', '#5c5040', '#77dada', '#da77da'] as const;

function colorCanvas(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function translucent(color: number, alpha: number): Material3D {
  return new Material3D({
    baseColor: color,
    alpha,
    metallic: 0.0,
    roughness: 0.35,
    alphaMode: 'blend',
  });
}

export const scene: TestScene = {
  create: async (app) => {
    const [right, left, top, bottom, front, back] = FACE_COLORS.map((c) => Texture.from(colorCanvas(c)));
    const environment = CubeTexture.from({
      faces: { right, left, top, bottom, front, back },
      label: 'alpha-blend-test-environment',
    });

    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'aces',
      exposure: 1.0,
    });
    view3d.background = environment;
    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 1.5, 6);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.4 }));

    const keyLight = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    keyLight.position.set(4, 6, 8);
    keyLight.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(keyLight);

    const sphereGeo = new SphereGeometry({ radius: 1, widthSegments: 32, heightSegments: 24 });
    const cubeGeo = new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 });
    const torusGeo = new TorusGeometry({ radius: 0.85, tube: 0.28, radialSegments: 32, tubularSegments: 48 });

    const sphereRed = new Mesh3D({ geometry: sphereGeo, material: translucent(0xff3b5c, 0.45) });
    sphereRed.position.set(-1.6, 0.2, 0.6);
    view3d.root.addChild(sphereRed);

    const sphereCyan = new Mesh3D({ geometry: sphereGeo, material: translucent(0x3bd6ff, 0.45) });
    sphereCyan.position.set(1.4, 0.2, 0.4);
    view3d.root.addChild(sphereCyan);

    const cubeYellow = new Mesh3D({ geometry: cubeGeo, material: translucent(0xffd84a, 0.55) });
    cubeYellow.position.set(0.2, 0.9, -1.0);
    view3d.root.addChild(cubeYellow);

    const torus = new Mesh3D({ geometry: torusGeo, material: translucent(0x9b5cff, 0.4) });
    torus.position.set(-0.8, 1.4, 0.0);
    torus.rotation.set(Math.PI * 0.25, 0, Math.PI * 0.15);
    view3d.root.addChild(torus);
  },
};
