import type { TestScene } from '@test-utils';
import { Color } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { solidTexture } from './helpers/solidTexture';

const COLOURS = [0xff4040, 0xff9a2e, 0xf5e642, 0x4ed95c, 0x2ee6d6, 0x3d7ae0, 0xa24bff, 0xff4fb8];
const TEXTURE_COLOURS = ['#ff2266', '#22ff88', '#2288ff', '#ffee22'];
const TINTED = 17;

export const scene: TestScene = {
  app: { backgroundColor: 0x101018 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 0, 12);

    const geometry = new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 });
    const add = (c: number, y: number, material: FlatMaterial) => {
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.set(c - 4, y, 0);
      view3d.root.addChild(mesh);
      return mesh;
    };
    const addTextured = (c: number, colour: string) =>
      add(c, 0, new FlatMaterial({ baseColorTexture: solidTexture(colour) }));

    const colourMaterials = COLOURS.map((baseColor) => new FlatMaterial({ baseColor }));
    colourMaterials.forEach((material, c) => add(c, 3, material));

    const shared = new FlatMaterial({ baseColor: 0x667788 });
    const sharedRow = Array.from({ length: 8 }, (_, c) => add(c, 2, shared));
    app.render();

    colourMaterials.forEach((material, c) => add(c, 1, material));
    addTextured(0, TEXTURE_COLOURS[0]);
    const hiddenTextured = addTextured(2, TEXTURE_COLOURS[1]);
    addTextured(4, TEXTURE_COLOURS[2]);
    const leaving = addTextured(6, TEXTURE_COLOURS[3]);
    app.render();

    view3d.root.removeChild(leaving);
    app.render();

    hiddenTextured.visible = false;
    sharedRow[0].visible = false;

    const white = solidTexture('#ffffff');
    for (let i = 0; i < TINTED; i++) {
      const baseColor = new Color({ h: (i * 360) / TINTED, s: 85, l: 60 }).toNumber();
      add(i < 9 ? i : i - 9, i < 9 ? -2 : -3, new FlatMaterial({ baseColor, baseColorTexture: white }));
    }
  },
};
