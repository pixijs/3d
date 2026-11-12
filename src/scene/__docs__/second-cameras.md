---
title: Second cameras
description: Draw the scene from a second camera into a texture, and show it on a monitor, in a 2D sprite or through a portal.
category: scene
---

# Second cameras

A {@link View3D} draws from one camera, {@link View3D#camera | view3d.camera}. To show the same scene from somewhere else at the same time, such as on a security monitor, in a minimap or through a doorway, add a second {@link Camera3D} with a {@link Camera3D#renderTexture | renderTexture}, and tell the view to draw from it. The view draws the scene from that camera into the render texture, and you show the render texture like any other texture. Don't build a second view for this. [A node belongs to one view](../../__docs__/concepts/view3d.md#several-views), so a second view would need a second copy of the scene.

The [Second cameras](/3d/examples?example=cameras_render-to-texture) example shows a monitor, a minimap and split screen.

## A camera that draws into a texture

```ts
import { Camera3D, MeshPass } from '@pixi/3d';
import { RenderTexture } from 'pixi.js';

const renderTexture = RenderTexture.create({ width: 512, height: 288, autoGenerateMipmaps: true });
const securityCamera = new Camera3D({ fov: 56, near: 0.5, far: 60, renderTexture });

securityCamera.position.set(-3.2, 6.2, -10.2);
view3d.root.addChild(securityCamera);
securityCamera.lookAt({ x: 0.8, y: 0.5, z: -1.6 });

view3d.passes = [
  new MeshPass({ name: 'opaque', camera: securityCamera }),
  new MeshPass({ name: 'transparent', camera: securityCamera, sort: 'distance' }),
];
```

Add the camera under `view3d.root`, and keep it and every node above it visible, so the view keeps track of where it is. A second camera outside the scene makes the next render throw.

The camera draws nothing on its own. {@link View3D#passes | view3d.passes} adds passes, the drawing steps of a frame, and a {@link MeshPass} is a pass that draws meshes. Most materials belong to one of two passes the view always draws: `'opaque'` for solid surfaces and `'transparent'` for see-through ones. A `MeshPass` with the same name and a `camera` draws the same meshes again, from that camera, into its texture. {@link MeshPassOptions#sort | sort: 'distance'} draws the see-through meshes back to front from the second camera, so they overlap correctly from its side too. Glass, a {@link Material3D} with {@link Material3DOptions#transmission | transmission}, draws in passes of its own and stays out of the render texture. {@link RenderPassOptions#camera} lists the passes that would add it.

The camera's {@link Camera3D#fov | fov} is vertical, and the texture's shape sets how wide it sees. Make the texture the shape of the screen that shows it, such as 512 by 288 for a 16:9 monitor.

`autoGenerateMipmaps: true` asks for mipmaps, smaller copies of the picture that keep it from shimmering when the monitor is small on screen. Pass it to `RenderTexture.create`, because setting it on the texture after its first frame has no effect. Meshes in a render texture have jagged edges even on an antialiased canvas. Create the texture with `antialias: true` to smooth them.

## Showing the render texture

To show the render texture on a monitor in the scene, use a {@link FlatMaterial}. It draws its texture without lighting, so the screen looks lit from within:

```ts
import { FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';

const screen = new Mesh3D({
  geometry: new PlaneGeometry({ width: 4, height: 2.25, flipV: true }),
  material: new FlatMaterial({ baseColorTexture: renderTexture }),
});

screen.position.set(0, 2.5, -10.05);
view3d.root.addChild(screen);
```

Without {@link PlaneGeometryOptions#flipV | flipV}, the render texture shows upside down, as any picture does on a plane.

A pixi `Sprite` shows the render texture the right way up with no flip, which suits a minimap in a corner of the screen. This minimap looks straight down through an [orthographic](./cameras.md#orthographic-cameras) camera. Nothing shrinks with distance in an orthographic camera, so this one shows 30 units across, twice its {@link Camera3D#orthographicSize | orthographicSize}, at any height:

```ts
import { Camera3D, MeshPass } from '@pixi/3d';
import { RenderTexture, Sprite } from 'pixi.js';

const mapTexture = RenderTexture.create({ width: 256, height: 256, resolution: app.renderer.resolution });
const mapCamera = new Camera3D({ mode: 'orthographic', orthographicSize: 15, renderTexture: mapTexture });

mapCamera.position.set(0, 40, 0);
mapCamera.rotation.x = -Math.PI / 2; // straight down, with -Z at the top of the map
view3d.root.addChild(mapCamera);
view3d.passes = [
  new MeshPass({ name: 'opaque', camera: mapCamera }),
  new MeshPass({ name: 'transparent', camera: mapCamera, sort: 'distance' }),
];

const minimap = new Sprite(mapTexture);

minimap.position.set(app.screen.width - 266, 10);
app.stage.addChild(minimap);
```

For split screen, set the view camera's {@link Camera3D#viewport | viewport} to one half of the view, and show the second player's render texture in a sprite on the other half. Give a minimap or a second player a render texture, not a viewport of its own, because a second camera without a texture draws over the view's picture.

Each second camera draws the scene's meshes again every frame, even while nothing on screen shows its render texture. Hiding the sprite or the monitor doesn't stop it. To pause one, such as a minimap the player closes, set {@link Pass3D#enabled | enabled} to `false` on each of its passes, and the render texture keeps its last picture. Each change to `enabled` makes the view rebuild how it draws a frame, so change it only now and then, such as when the player opens or closes the map, not every frame.

A render texture is 8-bit by default. The view applies its {@link View3D#exposure | exposure} and {@link View3D#toneMapping | toneMapping} to an 8-bit render texture, the settings that turn the scene's light into screen colours. So a sprite shows the render texture in the view's colours, but without the view's post effects, such as bloom. A monitor matches the scene only at the view's defaults, an exposure of 1 and `toneMapping: 'none'`. Keep a monitor's render texture 8-bit. {@link Camera3D#renderTexture} has the details.

## Drawing the background

The view draws its {@link View3D#background | background} for its own camera only. Where the second camera sees no mesh, the render texture is transparent black, and a monitor shows black. A {@link BackgroundPass} with the second camera draws the background into the render texture too. `view3d.passes` takes only {@link Pass3D} objects, and `BackgroundPass` isn't one. Wrap it in a small `Pass3D` whose {@link Pass3D#build | build} adds it, as [How a graph runs passes](../../post-processing/__docs__/custom-passes.md#how-a-graph-runs-passes) explains:

```ts
import { BackgroundPass, Camera3D, MeshPass, Pass3D } from '@pixi/3d';
import type { PassContext, RenderGraph } from '@pixi/3d';

class SkyPass extends Pass3D {
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
  new SkyPass(securityCamera),
  new MeshPass({ name: 'opaque', camera: securityCamera }),
  new MeshPass({ name: 'transparent', camera: securityCamera, sort: 'distance' }),
];
```

The sky paints over whatever the render texture already holds, so it has to draw first. It runs at the `'beforeOpaque'` stage, where the second camera's mesh passes draw, and comes ahead of them in the list. It draws the view's `background`, so give the view one.

## Portals

A portal is a doorway that shows another place, as if the two were joined. {@link PortalPass} and {@link PortalMaterial}, from `@pixi/3d/extras`, build one from two quads, flat rectangles made with `PlaneGeometry`. The entry is the quad you look into. The exit is a matching quad in the other place. Each faces along its own +Z, the entry toward you and the exit into the place it shows.

```ts
import { FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import { PortalMaterial, PortalPass } from '@pixi/3d/extras';
import { RenderTexture } from 'pixi.js';

const renderTexture = RenderTexture.create({
  width: app.screen.width,
  height: app.screen.height,
  resolution: app.renderer.resolution,
});
const doorway = new PlaneGeometry({ width: 3.4, height: 4.4 });
const entry = new Mesh3D({ geometry: doorway, material: new PortalMaterial({ texture: renderTexture }) });
const exit = new Mesh3D({ geometry: doorway, material: new FlatMaterial({ baseColor: 0x05070c }) });
const portal = new PortalPass({ entry, exit, texture: renderTexture });

entry.position.set(0, 2.2, -12.65);
exit.position.set(60, 2.2, -6.65);
view3d.root.addChild(entry, exit);
view3d.passes = [portal];

app.ticker.add(() => {
  const { width, height } = app.screen;

  if (width !== renderTexture.width || height !== renderTexture.height) {
    renderTexture.resize(width, height, app.renderer.resolution);
  }
});
```

Each frame, the pass places its own camera behind the exit, matching the view camera's place in front of the entry. It draws the far side into the render texture and leaves out the exit and everything behind it. `PortalMaterial` shows each pixel of the render texture at the same place on screen, so the entry looks like an opening rather than a picture.

The [Portals](/3d/examples?example=post_portal) example opens a doorway onto a world under the floor.

- **Size the render texture to the view, and resize it with the view.** The material spreads the whole render texture over the whole view, so one of another shape stretches the far side, and a smaller one blurs it. The view here fills the screen, so the ticker follows `app.screen`.
- **Give the entry and exit the same scale.** If you scale only one of them, the portal camera picks up that scale and the far side comes out bigger or smaller. Set their size with the `PlaneGeometry` instead, as the shared `doorway` does.
- **Keep the exit visible.** The pass leaves it out of the render texture anyway.
- **Use a perspective view camera, and don't rotate the view on screen.** {@link PortalPass} says what goes wrong otherwise.
- **Leave the view's {@link View3D#exposure | exposure} at 1.** At any other value the far side comes out brighter or darker than the room it shows.
- **In a view with a post effect that runs before tone mapping, such as {@link BloomEffect | bloom}, create the render texture with `format: 'rgba16float'`.** An 8-bit render texture in that view washes out the far side.
- **The far side has no sky.** Enclose the far room, as the example does, or add a `BackgroundPass` on {@link PortalPass#camera | portal.camera} the way `SkyPass` does, and list it before the portal.

The pass skips frames where the entry is hidden, off screen or seen from behind.

## Cleaning up

When you're done with a second camera, take its passes out of `view3d.passes`, because a pass whose camera is gone makes the next render throw. {@link Camera3D#destroy | Destroying the camera} leaves its render texture alone, so destroy the render texture yourself. Destroy every mesh and sprite that uses it too. One still using a destroyed texture also throws, even a hidden mesh:

```ts
view3d.passes = []; // or the list without the second camera's passes
securityCamera.destroy();
screen.destroy({ geometry: true, material: true });
renderTexture.destroy(true);
```

{@link PortalPass#destroy | portal.destroy()} releases the camera the pass made. The view never calls it, even when you destroy the view, so call it yourself and take the pass out of `view3d.passes` before the next render. Destroy the quads and the render texture yourself too.

## Next steps

- [Cameras](./cameras.md): placing and aiming a camera, field of view, near and far.
- [Environment and IBL](./environment.md#the-background): the background a second camera can draw too.
- [Custom render passes](../../post-processing/__docs__/custom-passes.md#drawing-meshes-again): mesh passes that draw meshes again with a shader of their own.
