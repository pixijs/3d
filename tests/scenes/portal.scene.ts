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

/**
 * A texture portal, held still: a warm wall carrying the opening, and a cool room sixty metres
 * away that can only be seen through it.
 *
 * Only what the frame shows is built — a floor and the pierced wall on this side, a floor, a back
 * wall and two blocks on the other. The camera stands off to one side, so the picture proves the
 * two things the pass is for. The blue room is framed by the opening rather than pasted flat on
 * the quad — sampling at the fragment's own screen position is what puts it off-axis to match the
 * viewer. And the wall the far door is cut into never shows, because the camera's clipping plane
 * is the exit surface.
 *
 * The oblique clip plane lands the exit at the projection's near face; on WebGPU the bound
 * projection is remapped to that backend's clip range, so the near slab of the far room survives
 * there as it does on WebGL.
 */

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

    // `PlaneGeometry` lies in its local XY with a +Z normal, so a floor is a quarter turn away.
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

    // --- This side: the floor underfoot and the wall the opening is cut into. Nothing else is
    // in shot — the viewer stands close, facing the wall.
    deck(0, 0, 26, 26, 0x5a5348);
    slab(0, 3.5, ROOM_A_WALL_Z, 26.6, 7, 0.6, 0x8c7b66);

    // --- The cool room, only ever seen through the opening ---
    // A closed box, all six sides in shot: the portal camera stands at the exit and the opening
    // frames the lot. The wall at `ROOM_B_WALL_Z` is the one the far door is cut into — the
    // clipping plane takes it, which is the other half of what the picture proves.
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

    // --- The pair ---
    // The feed is the view's own size: the material maps a fragment's screen position straight
    // onto its UVs, so a mismatched aspect would stretch the far room.
    const feed = RenderTexture.create({
      width: app.screen.width,
      height: app.screen.height,
      resolution: app.renderer.resolution,
      scaleMode: 'linear',
      label: 'portalFeed',
    });

    const portalGeometry = new PlaneGeometry({ width: PORTAL_WIDTH, height: PORTAL_HEIGHT });

    // Portals face local +Z, which is `PlaneGeometry`'s own front, so neither quad needs rotating.
    const entry = new Mesh3D({ geometry: portalGeometry, material: new PortalMaterial({ texture: feed }) });
    entry.position.set(0, PORTAL_HEIGHT / 2, ROOM_A_WALL_Z + 0.35);
    view3d.root.addChild(entry);

    // The exit's +Z faces into the cool room, the side the content is on. It is never seen — the
    // clipping plane cuts from its surface backwards, itself included.
    const exit = new Mesh3D({ geometry: portalGeometry, material: new FlatMaterial({ baseColor: 0x05070c }) });
    exit.position.set(ROOM_B_X, PORTAL_HEIGHT / 2, ROOM_B_WALL_Z + 0.35);
    view3d.root.addChild(exit);

    const frame = 0x3c3229;
    slab(0, PORTAL_HEIGHT + 0.15, ROOM_A_WALL_Z + 0.3, PORTAL_WIDTH + 0.6, 0.3, 0.25, frame);
    slab(-(PORTAL_WIDTH + 0.3) / 2, PORTAL_HEIGHT / 2, ROOM_A_WALL_Z + 0.3, 0.3, PORTAL_HEIGHT + 0.3, 0.25, frame);
    slab((PORTAL_WIDTH + 0.3) / 2, PORTAL_HEIGHT / 2, ROOM_A_WALL_Z + 0.3, 0.3, PORTAL_HEIGHT + 0.3, 0.25, frame);

    const portal = new PortalPass({ entry, exit, texture: feed });

    // A pass camera has to live in the view it draws from; the pass poses it every frame.
    view3d.passes = [portal];

    // Held off-axis on purpose: dead ahead, a screen-position sample and a plain UV sample would
    // agree, and the picture would prove nothing.
    view3d.camera.fov = 70;
    view3d.camera.near = 0.15;
    view3d.camera.far = 200;
    view3d.camera.position.set(2.6, 1.75, -3.2);
    view3d.camera.lookAt({ x: 0, y: PORTAL_HEIGHT / 2, z: ROOM_A_WALL_Z + 0.35 });
  },
};
