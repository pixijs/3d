---
title: View3D and the 2D/3D bridge
description: How a View3D sits in the PixiJS display list, from sizing and several views to 2D behind and over 3D, filters, masks and resolution, and converting between screen and world positions.
category: core-concepts
---

# View3D and the 2D/3D bridge

A {@link View3D} is a PixiJS display object that draws a 3D scene. You add it to the stage, then move, scale, mask and filter it like a sprite. Everything in the scene goes under {@link View3D#root | view3d.root}; `view3d.addChild` throws.

## Size and place a view

{@link View3D#autoResize | autoResize} gives a view the renderer's screen size on every render, so a full-screen view follows the canvas when the window resizes. Without it, a view keeps the width and height you give it, 256 by 256 by default. {@link View3D#anchor | anchor} works as a sprite's does. This keeps a centred inset sized to the window:

```ts
import { View3D } from '@pixi/3d';

const view3d = new View3D({ anchor: 0.5 });

app.stage.addChild(view3d);

const layout = (): void => {
  view3d.position.set(app.screen.width / 2, app.screen.height / 2);
  view3d.setSize(app.screen.width - 32, app.screen.height - 96);
};

layout();
app.renderer.on('resize', layout);
```

Three 2D habits work differently on a view:

- Setting {@link View3D#width | width} or {@link View3D#height | height}, or calling {@link View3D#setSize | setSize}, resizes the 3D viewport, the rectangle the camera draws into; it doesn't scale the view as it would a `Sprite`. It also turns `autoResize` off, so set `autoResize` back to `true` to follow the screen again.
- The scene doesn't stretch to the view's new shape: the camera sees more or less of it. [Cameras](../../scene/__docs__/cameras.md#field-of-view) explains which way, and how to keep a scene in frame.
- A rotated view still draws into the upright rectangle that holds it, so its background, and any mesh reaching past its edges, show in the corners outside it. Mask it to its own rectangle.

## Several views

Each view is a separate scene, with its own root, camera, lights and environment, so a light in one view doesn't light another. A node belongs to one view at a time: adding it under another view's root takes it out of the first, as `addChild` does in 2D.

To show the same scene from a second angle, such as on a security monitor, don't build a second view: give a second camera a {@link Camera3D#renderTexture | renderTexture}, add it under `view3d.root` and tell the view to draw from it, as [Second cameras](../../scene/__docs__/second-cameras.md) shows.

## 2D behind and over a view

A view draws its whole scene at its place in the display list, so 2D content added before it draws behind the scene and 2D content added after it draws over it:

```ts
app.stage.addChild(backdrop); // behind the 3D scene
app.stage.addChild(view3d);
app.stage.addChild(scoreText); // over the 3D scene
```

A view has no {@link View3D#background | background} by default, so the 2D content behind it shows wherever no mesh covers it, and a mesh whose material has an {@link AlphaMode | alphaMode} of `'blend'` blends over that content. Glass, a material with {@link Material3DOptions#transmission | transmission}, can show that content through it; [Physical extensions](../../materials/__docs__/physical.md#how-glass-draws) says when.

Because the scene draws in one go, no 2D object can go between two meshes of the same view. To put 2D content among 3D objects, draw it onto a 3D surface, as [Rendering 2D into 3D](../../core/__docs__/container-texture.md) shows.

By default a view catches the pointer anywhere in its rectangle, even over empty space, so interactive 2D content behind it never gets the pointer; [Interaction](../../events/__docs__/interaction.md#2d-content-and-the-view) shows the ways around that.

## Filters and masks

PixiJS filters work on a view, or on a 2D container that holds one, and masks clip a view as they clip a sprite. This blurs a view:

```ts
import { BlurFilter } from 'pixi.js';

view3d.filters = [new BlurFilter({ strength: 2, antialias: 'inherit', resolution: 'inherit' })];
```

[Filters](/3d/examples?example=2d3d_filters) turns a blur, a black-and-white filter, a fade and a mask with rounded corners on and off on one view.

- By default a filter draws with one sample per pixel at a `resolution` of 1. A view under it loses its sharpness on a canvas with a `resolution` above 1, and the canvas's `antialias` smoothing unless the view is in [composite mode](#resolution-and-composite-mode). Create every filter on the view or a container holding it with `antialias: 'inherit'` and `resolution: 'inherit'` to keep both, as the blur above does.
- To fade a view, give it, or a container holding it, an `AlphaFilter`, and to tint it, a `ColorMatrixFilter`; `view3d.alpha` and `view3d.tint` do neither.
- For effects inside the 3D scene, such as bloom or ambient occlusion, add post effects, which [Post-processing](../../post-processing/__docs__/post-processing.md) covers.

## Resolution and composite mode

By default a view draws its scene at the resolution of its target, what it draws into, usually the canvas. Lower {@link View3D#resolution | resolution} when a device can't keep up: the scene draws fewer pixels and stretches them over the view. The number is absolute, like a filter's `resolution`, so derive it from the renderer's:

```ts
view3d.resolution = app.renderer.resolution * 0.67; // two thirds of the width and height
```

A resolution other than the target's puts the view in composite mode: it draws its scene into a texture of its own, then draws that texture onto the target. {@link View3DOptions#composite | composite: true} and any enabled post effect do the same. This texture keeps the canvas's `antialias`; [Post-processing](../../post-processing/__docs__/post-processing.md#the-passes-list) says when it can't. 2D content behind the view still shows through, but not through [glass](../../materials/__docs__/physical.md#how-glass-draws).

If the resolution changes as the app runs, create the view with `composite: true`. Without it, a view with no enabled post effect rebuilds its passes, the drawing steps of its frame, each time the resolution leaves or returns to the target's.

## From the 3D world to the screen

{@link View3D#worldToScreen | worldToScreen} turns a point in the 3D world into PixiJS's global 2D coordinates, the space of `event.global`, allowing for the view's anchor, position, scale and rotation. Use it to pin labels, health bars and markers to 3D objects, and add them after the view so they draw over it. A label added straight to an untouched `app.stage` can take the result as its position; inside a container that is moved, scaled or rotated, convert it with `label.parent.toLocal(point, undefined, label.position)`.

The point has to be in world space, the coordinates of the scene as a whole rather than of a node's parent. {@link Container3D#getGlobalPosition | getGlobalPosition} gives a node's world position. This adds 0.6 to its `y` to put a drone's label just above it, in world units, so the offset doesn't turn or scale with the drone:

```ts
import { Vector3 } from '@pixi/3d';
import { Point } from 'pixi.js';

const above = new Vector3();
const screen = new Point();

app.ticker.add(() => {
  drone.getGlobalPosition(above);
  above.y += 0.6; // just above the drone, in world units

  const point = view3d.worldToScreen(above, screen);

  label.visible = point !== null;
  if (point) label.position.copyFrom(point);
});
```

`app.ticker` draws the frame after the code you add to it, so labels placed there match what it draws, even while a camera controller moves the camera from `Ticker.shared`, as it does by default. Size a view that carries labels from the renderer's `resize` event, as [Size and place a view](#size-and-place-a-view) does: with `autoResize`, a view takes the screen size only as it draws, so labels land in the wrong place on the first frame and a frame behind after each resize.

To pin a label to a spot on a model, such as its head, convert that spot from the model's own space with {@link Container3D#toGlobal | toGlobal}, which moves, turns and scales it with the model. [Screen and world](/3d/examples?example=2d3d_coordinates) pins a name tag to the top of each clay piece this way.

`worldToScreen` returns `null` for a point at or behind the camera in perspective {@link Camera3D#mode | mode}, the default: hide the label then. A point off to one side of the camera's view still gets a position, outside the view's rectangle. Passing your own objects to write into, as `above` and `screen` are here, keeps the per-frame code from allocating.

## From the screen into the 3D world

A point on the screen marks a ray, a line through the scene whose every point lands on that spot. {@link View3D#screenToRay | screenToRay} returns that {@link Ray} for a point in global coordinates, such as `event.global`. {@link View3D#screenToWorld | screenToWorld} goes on to a point along it: where it meets a {@link Plane}, or, given a number instead, that many units from the camera. Both work for a view that moves, scales or rotates on the stage.

This moves a ring to the spot on the ground under the pointer:

```ts
import { Plane, Vector3 } from '@pixi/3d';

const ground = new Plane(new Vector3(0, 1, 0), 0); // y = 0, facing up; a floor at y = h takes -h
const hit = new Vector3();

view3d.on('pointermove', (event) => {
  const point = view3d.screenToWorld(event.global, ground, hit);

  ring.visible = point !== null && Math.hypot(point.x, point.z) < 5.6; // on a round floor of radius 5.6
  if (point) ring.position.set(point.x, 0.04, point.z);
});
```

With a plane, `screenToWorld` returns `null` when the ray misses the plane, as for a pointer above the horizon. The plane goes on for ever, so check that the point lies on your ground, as the radius check does for the round floor.

With an {@link OrbitCamera} on the view, a drag that turns the camera can end in a `pointertap` too, so [Screen and world](/3d/examples?example=2d3d_coordinates) drops a shape on a `pointertap` only when the tap lands within a few pixels of its `pointerdown`; [Interaction](../../events/__docs__/interaction.md#clicks-hover-and-cursors) explains why.

These methods never look at meshes. To find the object under the pointer, listen for pointer events on the objects, or call {@link View3D#raycast | raycast}; [Interaction](../../events/__docs__/interaction.md) covers both.

## Next steps

- [Scene graph and transforms](./scene-graph.md): positions, rotations and world space.
- [Cameras](../../scene/__docs__/cameras.md): placing and aiming the camera.
- [Rendering 2D into 3D](../../core/__docs__/container-texture.md): drawing PixiJS containers onto 3D surfaces.
