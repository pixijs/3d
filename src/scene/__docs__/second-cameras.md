---
title: Second cameras
description: Draw the scene from a second camera into a texture, and show it on a monitor, in a 2D sprite or through a portal.
category: scene
---

# Second cameras

A {@link View3D} draws from one camera, {@link View3D#camera | view3d.camera}. To show the same scene from somewhere else at the same time, such as on a security monitor, in a minimap or through a doorway, add a second {@link Camera3D} with a {@link Camera3D#renderTexture | renderTexture} and tell the view to draw from it. The view draws the scene from that camera into the texture, which this page calls the feed, and you show the feed like any other texture. Don't build a second view for this: [a node belongs to one view](../../__docs__/concepts/view3d.md#several-views), so a second view would need a second copy of the scene.

The [Second cameras](/3d/examples?example=cameras_render-to-texture) example shows a monitor, a minimap and split screen.

## A camera that draws into a texture

```ts
import { Camera3D, MeshPass } from '@pixi/3d';
import { RenderTexture } from 'pixi.js';

const feed = RenderTexture.create({ width: 512, height: 288, autoGenerateMipmaps: true });
const securityCamera = new Camera3D({ fov: 56, near: 0.5, far: 60, renderTexture: feed });

securityCamera.position.set(-3.2, 6.2, -10.2);
view3d.root.addChild(securityCamera);
securityCamera.lookAt({ x: 0.8, y: 0.5, z: -1.6 });

view3d.passes = [
  new MeshPass({ name: 'opaque', camera: securityCamera }),
  new MeshPass({ name: 'transparent', camera: securityCamera, sort: 'distance' }),
];
```

Add the camera under `view3d.root`, and keep it and every node above it visible, so the view keeps track of where it is. A second camera outside the scene makes the next render throw.

The camera draws nothing on its own. {@link View3D#passes | view3d.passes} adds passes, drawing steps of the frame, and a {@link MeshPass} draws meshes. Most materials belong to one of two passes the view always draws: `'opaque'` for solid surfaces and `'transparent'` for see-through ones. A `MeshPass` with the same name and a `camera` draws the same meshes again, from that camera, into its texture. {@link MeshPassOptions#sort | sort: 'distance'} draws the see-through ones back to front from the second camera, so they overlap correctly from its side too. Glass, a {@link Material3D} with {@link Material3DOptions#transmission | transmission}, draws in passes of its own and stays out of the feed; {@link RenderPassOptions#camera} lists the passes that would add it.

The camera's {@link Camera3D#fov | fov} is vertical, and the texture's shape sets how wide it sees. Make the texture the shape of the screen that shows it, such as 512 by 288 for a 16:9 monitor.

`autoGenerateMipmaps: true` asks for mipmaps, smaller copies of the picture that keep it from shimmering when the monitor is small on screen. Pass it to `RenderTexture.create`: set on the texture after its first frame, it has no effect. A feed's edges come out jagged even on an antialiased canvas; create the texture with `antialias: true` to smooth them.

## Showing the feed

On a monitor in the scene, show the feed with a {@link FlatMaterial}, which draws its texture without lighting, so the screen looks lit from within:

```ts
import { FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';

const screen = new Mesh3D({
  geometry: new PlaneGeometry({ width: 4, height: 2.25, flipV: true }),
  material: new FlatMaterial({ baseColorTexture: feed }),
});

screen.position.set(0, 2.5, -10.05);
view3d.root.addChild(screen);
```

Without {@link PlaneGeometryOptions#flipV | flipV}, the feed shows upside down, as any picture does on a plane.

A pixi `Sprite` shows the feed the right way up as it is, which suits a minimap in a corner of the screen. This one looks straight down with an [orthographic](./cameras.md#orthographic-cameras) camera, which shows 30 units across, twice its {@link Camera3D#orthographicSize | orthographicSize}, however high it hangs:

```ts
import { Camera3D, MeshPass } from '@pixi/3d';
import { RenderTexture, Sprite } from 'pixi.js';

const mapFeed = RenderTexture.create({ width: 256, height: 256, resolution: app.renderer.resolution });
const mapCamera = new Camera3D({ mode: 'orthographic', orthographicSize: 15, renderTexture: mapFeed });

mapCamera.position.set(0, 40, 0);
mapCamera.rotation.x = -Math.PI / 2; // straight down, with -Z at the top of the map
view3d.root.addChild(mapCamera);
view3d.passes = [
  new MeshPass({ name: 'opaque', camera: mapCamera }),
  new MeshPass({ name: 'transparent', camera: mapCamera, sort: 'distance' }),
];

const minimap = new Sprite(mapFeed);

minimap.position.set(app.screen.width - 266, 10);
app.stage.addChild(minimap);
```

For split screen, set the view camera's {@link Camera3D#viewport | viewport} to one half of the view and show the second player's feed in a sprite on the other half. Give a minimap or a second player a feed rather than a viewport of its own: a second camera without a texture draws over the view's picture.

Each feed draws the scene's meshes again every frame, even while nothing on screen shows it: hiding the sprite or the monitor doesn't stop it. To pause a feed, such as a minimap the player closes, set {@link Pass3D#enabled | enabled} to `false` on each of its passes, and the feed keeps its last picture. Each flip makes the view rebuild how it draws the frame, so use it as a toggle, not every frame.

An 8-bit feed, the default, has the view's {@link View3D#exposure | exposure} and {@link View3D#toneMapping | toneMapping} applied, the settings that turn the scene's light into screen colours. So a sprite shows the feed in the view's colours, but without the view's post effects, such as bloom. A monitor matches the scene only at the view's defaults, an exposure of 1 and `toneMapping: 'none'`. Keep a monitor's feed 8-bit; {@link Camera3D#renderTexture} has the details.

## A sky in the feed

The view draws its {@link View3D#background | background} for its own camera only, so where the second camera sees no mesh, the feed is transparent black and a monitor shows black. A {@link BackgroundPass} with the second camera draws the background into the feed too. `view3d.passes` takes only a {@link Pass3D}, and `BackgroundPass` isn't one, so wrap it in a small `Pass3D` whose {@link Pass3D#build | build} adds it, as [How a graph runs passes](../../post-processing/__docs__/custom-passes.md#how-a-graph-runs-passes) explains:

```ts
import { BackgroundPass, Camera3D, MeshPass, Pass3D } from '@pixi/3d';
import type { PassContext, RenderGraph } from '@pixi/3d';

class FeedSkyPass extends Pass3D {
  public readonly stage = 'beforeOpaque';
  private readonly _camera: Camera3D;

  constructor(camera: Camera3D) {
    super();
    this._camera = camera;
  }

  public build(graph: RenderGraph, { renderer }: PassContext): void {
    graph.addPass(new BackgroundPass({ renderer, camera: this._camera }));
  }
}

view3d.passes = [
  new FeedSkyPass(securityCamera),
  new MeshPass({ name: 'opaque', camera: securityCamera }),
  new MeshPass({ name: 'transparent', camera: securityCamera, sort: 'distance' }),
];
```

The sky paints over whatever the feed already holds, so it goes at `'beforeOpaque'`, where the feed's mesh passes draw, and ahead of them in the list. It draws the view's `background`, so give the view one.

## Portals

A portal is a doorway that shows another place, as if the two were joined. {@link PortalPass} and {@link PortalMaterial}, from `@pixi/3d/extras`, build one from two quads, flat rectangles made with `PlaneGeometry`. The entry is the quad you look into. The exit is a matching quad in the other place, and both face their own +Z: the entry toward you, the exit into the place it shows.

```ts
import { FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import { PortalMaterial, PortalPass } from '@pixi/3d/extras';
import { RenderTexture } from 'pixi.js';

const feed = RenderTexture.create({
  width: app.screen.width,
  height: app.screen.height,
  resolution: app.renderer.resolution,
});
const doorway = new PlaneGeometry({ width: 3.4, height: 4.4 });
const entry = new Mesh3D({ geometry: doorway, material: new PortalMaterial({ texture: feed }) });
const exit = new Mesh3D({ geometry: doorway, material: new FlatMaterial({ baseColor: 0x05070c }) });
const portal = new PortalPass({ entry, exit, texture: feed });

entry.position.set(0, 2.2, -12.65);
exit.position.set(60, 2.2, -6.65);
view3d.root.addChild(entry, exit);
view3d.passes = [portal];

app.ticker.add(() => {
  const { width, height } = app.screen;

  if (width !== feed.width || height !== feed.height) feed.resize(width, height, app.renderer.resolution);
});
```

Each frame, the pass stands its own camera behind the exit as you stand in front of the entry, and draws the far side into the feed, leaving out the exit and everything behind it. `PortalMaterial` shows each pixel of the feed at the same place on screen, so the entry reads as an opening rather than a picture.

The [Portals](/3d/examples?example=post_portal) example opens a doorway onto a world under the floor.

- **Size the feed to the view, and resize it with the view.** The material spreads the whole feed over the whole view, so another shape stretches the far side, and fewer pixels blur it. The view here fills the screen, so the ticker follows `app.screen`.
- **Give the entry and exit the same scale.** A scale only one of them has carries into the portal camera and resizes the far side. Set their size with the `PlaneGeometry` instead, as the shared `doorway` does.
- **Keep the exit visible.** The pass leaves it out of the feed anyway.
- **Use a perspective view camera, and don't rotate the view on screen.** {@link PortalPass} says what goes wrong otherwise.
- **Leave the view's {@link View3D#exposure | exposure} at 1.** At any other value the far side comes out brighter or darker than the room it shows.
- **In a view with a post effect that runs before tone mapping, such as {@link BloomEffect | bloom}, create the feed with `format: 'rgba16float'`.** An 8-bit feed there washes the far side out.
- **The far side has no sky.** Close the far room in, as the example does, or add a `BackgroundPass` on {@link PortalPass#camera | portal.camera} the way `FeedSkyPass` does, listed before the portal.

The pass skips frames where the entry is hidden, off screen or seen from behind.

## Cleaning up

When you're done with a feed, take its passes out of `view3d.passes`, since a pass whose camera is gone makes the next render throw. {@link Camera3D#destroy | Destroying the camera} leaves its texture alone, so destroy the feed yourself, along with every mesh and sprite that uses it, since one left on a destroyed texture throws too, even a hidden mesh:

```ts
view3d.passes = []; // or the list without the feed's passes
securityCamera.destroy();
screen.destroy({ geometry: true, material: true });
feed.destroy(true);
```

{@link PortalPass#destroy | portal.destroy()} releases the camera the pass made. The view never calls it, even on its own destroy, so call it yourself and take the pass out of `view3d.passes` before the next render. The quads and the feed are yours to destroy.

## Next steps

- [Cameras](./cameras.md): placing and aiming a camera, field of view, near and far.
- [Environment and IBL](./environment.md#the-background): the background a feed's sky draws.
- [Custom render passes](../../post-processing/__docs__/custom-passes.md#drawing-meshes-again): mesh passes that draw meshes again with a shader of their own.
