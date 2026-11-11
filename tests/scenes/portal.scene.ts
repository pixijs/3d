import type { TestScene } from '@test-utils';
import { RenderTexture } from 'pixi.js';

import { PortalMaterial } from '~/extras/materials/portal/PortalMaterial';
import { PortalPass } from '~/extras/post-processing/passes/portal/PortalPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const PORTAL_WIDTH = 3.4;
const PORTAL_HEIGHT = 4.4;
const ROOM_A_WALL_Z = -13;
const ROOM_B_X = 60;
const ROOM_B_WALL_Z = -7;

export const scene: TestScene = {
  app: {
    backgroundColor: 0x0d1117,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      environment: { skyColor: 0x9fb8d8, groundColor: 0x2b2418 },
    });

    app.stage.addChild(view3d);

    const surface = (color: number) => new Material3D({ baseColor: color, metallic: 0, roughness: 0.8 });

    const slab = (x: number, y: number, z: number, w: number, h: number, d: number, color: number) => {
      const wall = new Mesh3D({
        geometry: new CubeGeometry({ width: w, height: h, depth: d }),
        material: surface(color),
      });
      wall.position.set(x, y, z);
      view3d.root.addChild(wall);
    };

    const deck = (x: number, y: number, w: number, d: number, color: number, faceDown = false) => {
      const plane = new Mesh3D({ geometry: new PlaneGeometry({ width: w, height: d }), material: surface(color) });
      plane.position.set(x, y, 0);
      plane.rotation.set(faceDown ? Math.PI / 2 : -Math.PI / 2, 0, 0);
      plane.rotationDirty = true;
      view3d.root.addChild(plane);
    };

    const sun = new DirectionalLight({ color: 0xfff2d8, intensity: 3.5 });
    sun.rotation.set(-0.85, 0.5, 0);
    sun.rotationDirty = true;
    view3d.root.addChild(sun);

    deck(0, 0, 26, 26, 0x5a5348);
    slab(0, 3.5, ROOM_A_WALL_Z, 26.6, 7, 0.6, 0x8c7b66);

    deck(ROOM_B_X, 0, 12, 14, 0x2f3a4d);
    deck(ROOM_B_X, 6.5, 12, 14, 0x3a465c, true);
    slab(ROOM_B_X, 3.25, ROOM_B_WALL_Z, 12.6, 6.5, 0.6, 0x40506b);
    slab(ROOM_B_X, 3.25, 7, 12.6, 6.5, 0.6, 0x40506b);
    slab(ROOM_B_X - 6, 3.25, 0, 0.6, 6.5, 14.6, 0x384560);
    slab(ROOM_B_X + 6, 3.25, 0, 0.6, 6.5, 14.6, 0x384560);

    for (const [x, z, height, color] of [
      [3.2, 0.5, 3.4, 0x4fae5b],
      [-3.0, -2.0, 2.6, 0x3bb0ff],
    ] as const) {
      const block = new Mesh3D({
        geometry: new CubeGeometry({ width: 1.4, height, depth: 1.4 }),
        material: surface(color),
      });
      block.position.set(ROOM_B_X + x, height / 2, z);
      view3d.root.addChild(block);
    }

    const feed = RenderTexture.create({
      width: app.screen.width,
      height: app.screen.height,
      resolution: app.renderer.resolution,
      scaleMode: 'linear',
      label: 'portalFeed',
    });

    const portalGeometry = new PlaneGeometry({ width: PORTAL_WIDTH, height: PORTAL_HEIGHT });

    const entry = new Mesh3D({ geometry: portalGeometry, material: new PortalMaterial({ texture: feed }) });
    entry.position.set(0, PORTAL_HEIGHT / 2, ROOM_A_WALL_Z + 0.35);
    view3d.root.addChild(entry);

    const exit = new Mesh3D({ geometry: portalGeometry, material: new FlatMaterial({ baseColor: 0x05070c }) });
    exit.position.set(ROOM_B_X, PORTAL_HEIGHT / 2, ROOM_B_WALL_Z + 0.35);
    view3d.root.addChild(exit);

    const frame = 0x3c3229;
    slab(0, PORTAL_HEIGHT + 0.15, ROOM_A_WALL_Z + 0.3, PORTAL_WIDTH + 0.6, 0.3, 0.25, frame);
    slab(-(PORTAL_WIDTH + 0.3) / 2, PORTAL_HEIGHT / 2, ROOM_A_WALL_Z + 0.3, 0.3, PORTAL_HEIGHT + 0.3, 0.25, frame);
    slab((PORTAL_WIDTH + 0.3) / 2, PORTAL_HEIGHT / 2, ROOM_A_WALL_Z + 0.3, 0.3, PORTAL_HEIGHT + 0.3, 0.25, frame);

    const portal = new PortalPass({ entry, exit, texture: feed });

    view3d.passes = [portal];

    view3d.camera.fov = 70;
    view3d.camera.near = 0.15;
    view3d.camera.far = 200;
    view3d.camera.position.set(2.6, 1.75, -3.2);
    view3d.camera.lookAt({ x: 0, y: PORTAL_HEIGHT / 2, z: ROOM_A_WALL_Z + 0.35 });
  },
};
