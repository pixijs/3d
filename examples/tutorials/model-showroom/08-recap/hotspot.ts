import { Vector3 } from '@pixi/3d';
import type { Model3D, View3D } from '@pixi/3d';
import { Container, Graphics, Point, Text } from 'pixi.js';
import type { Application } from 'pixi.js';

import type { Clips } from './clips';

// A point on the fox's head, in the units of the fox's file
const HEAD = { x: 0, y: 64, z: 40 };

export function addHotspot(app: Application, view3d: View3D, fox: Model3D, clips: Clips) {
  // A dot on the head, a line up to the tag, and the tag itself, in one container whose origin is the dot
  const hotspot = new Container();
  const line = new Graphics().moveTo(0, 0).lineTo(36, -60).stroke({ color: 0xffffff, width: 2 });
  const dot = new Graphics().circle(0, 0, 5).fill(0xffffff).stroke({ color: 0xd81b60, width: 2 });
  const tag = new Container();
  const background = new Graphics();
  const text = new Text({
    text: '',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: '600', fill: 0x1d1a24 },
  });

  text.anchor.set(0, 0.5);
  text.position.set(14, 0);
  tag.position.set(36, -60);
  tag.addChild(background, text);
  hotspot.addChild(line, dot, tag);
  app.stage.addChild(hotspot);

  // Filled in every frame, so finding the head on screen makes no new objects
  const world = new Vector3();
  const screen = new Point();

  app.ticker.add(() => {
    // Show the name of the active animation, on a background sized to fit it
    if (text.text !== clips.current) {
      text.text = clips.current;
      background
        .clear()
        .roundRect(0, -16, text.width + 28, 32, 16)
        .fill(0xffffff);
    }

    // Where the head is in the scene, then where that is on the screen
    fox.toGlobal(HEAD, world);
    const point = view3d.worldToScreen(world, screen);

    // worldToScreen returns null for a point at or behind the camera
    hotspot.visible = point !== null;
    if (point) hotspot.position.copyFrom(point);
  });
}
