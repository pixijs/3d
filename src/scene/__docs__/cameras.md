---
title: Cameras
description: Placing and aiming the view's camera, field of view, near and far, orthographic cameras, switching cameras and framing a model.
category: scene
children:
  - ../../extras/__docs__/camera-controls.md
  - ./second-cameras.md
---

# Cameras

A {@link Camera3D} is the point of view a {@link View3D} draws its scene from. Every view comes with one, at {@link View3D#camera | view3d.camera}, and it sits under {@link View3D#root | view3d.root} with the rest of the scene. A camera is a {@link Container3D}, so you move, turn and parent it like any other node. Moving `view3d.root`, the way you'd scroll a 2D world container, doesn't scroll the picture. The camera moves with root, so meshes stay where they were on screen, while particles, which {@link ParticleContainer3DOptions#space | by default} don't move with root, slide out of place. Scaling root doesn't zoom in either. Move the camera, or set its `zoom`, instead.

## Placing the camera

The camera starts at the origin, where new meshes go too, so move it away from them first. It looks along its own -Z axis, so with no rotation it looks into the screen. {@link Container3D#lookAt | lookAt} turns it to face a point in world space, the coordinates of the scene as a whole:

```ts
view3d.camera.position.set(0, 2, 6); // up, and back toward the viewer
view3d.camera.lookAt({ x: 0, y: 0.5, z: 0 });
```

`lookAt` turns the camera once; when the camera or the point moves, call it again each frame, after the move. [Scene graph and transforms](../../__docs__/concepts/scene-graph.md) covers the axes, and how `lookAt` and `rotation` share a node. To steer the camera with the mouse, touch or keys, use a controller from [Camera controls](../../extras/__docs__/camera-controls.md).

Add the camera under another node and it moves and turns with that node. But take the camera or a node above it out of the view, or hide one of them, and the view throws the next time it draws. So for a player that carries the camera, put the player's model and the camera side by side in a plain `Container3D`. Then you can hide or scale the model without hiding or scaling the camera.

## Field of view

A camera starts in perspective {@link Camera3D#mode | mode}, where distant things look smaller. {@link Camera3D#fov | fov} is the vertical field of view: the angle, in degrees, from the bottom to the top of what the camera sees. The picture's shape sets the horizontal field, so a portrait phone sees less to each side than a landscape monitor, and a scene that fits the monitor loses its sides on the phone. "Framing a model" below backs the camera off far enough for either.

{@link Camera3D#zoom | zoom} magnifies on top of `fov`: at a zoom of 2 the scene looks twice as large. The view reads every camera setting each time it draws, so you can change or animate them at any time.

## Near and far

A camera draws only what lies between its {@link Camera3D#near | near} and {@link Camera3D#far | far} distances in front of it. Anything closer than `near` is cut away, so a camera that comes too close to a model cuts a hole in it.

Keep `near` as large as the scene allows. The depth buffer, which stores how far away each pixel is, has limited precision, and with a tiny `near`, distant surfaces that sit close together store the same depth and flicker through each other. Raising `near` fixes that; lowering `far` barely helps.

```ts
view3d.camera.near = 0.5; // just short of the closest the camera gets to anything it shows
view3d.camera.far = 300; // just past the farthest thing it shows
```

## Orthographic cameras

Set `mode` to `'orthographic'` and nothing shrinks with distance, which suits isometric games, maps and editors. {@link Camera3D#orthographicSize | orthographicSize} is half the width the camera sees, in world units. The shape of the picture sets the height, so the width always fits and a portrait phone sees more above and below.

```ts
const camera = view3d.camera;

camera.mode = 'orthographic';
camera.orthographicSize = 10; // 20 units across
camera.position.set(20, 20, 20);
camera.lookAt({ x: 0, y: 0, z: 0 }); // down the diagonal: an isometric view
```

Moving an orthographic camera closer doesn't make anything bigger: shrink `orthographicSize` instead, or raise `zoom`, which magnifies here too. It still draws only between `near` and `far`, so keep the whole scene in front of it. Leave the view's [background](./environment.md#the-background) `null` with an orthographic camera, and give the app a background colour instead.

## Switching cameras

Assign another camera to {@link View3D#camera | view3d.camera} to draw from it. A camera with no parent goes under `view3d.root` for you. A camera that already has a parent must be in this view's scene when you assign it, or the assignment throws. A glTF file, the model format PixiJS 3D loads, can bring its own cameras, listed in {@link Model3D#cameras | model.cameras}. They sit inside the model, so add the model to the view first:

```ts
import { Model3D } from '@pixi/3d';

const model = new Model3D({ source });
const ownCamera = view3d.camera;

view3d.root.addChild(model);
if (model.cameras.length > 0) view3d.camera = model.cameras[0];

// Later, back to the view's own camera
view3d.camera = ownCamera;
```

The previous camera stays in the scene as it was, so assigning it again switches back. A controller drives whichever camera the view has, so an {@link OrbitCamera} takes over the new camera on its next update. While the view draws from another camera, turn off the orbit's {@link OrbitCamera#enabled | enabled} so input leaves the camera alone, and stop its updates: turn off {@link OrbitCamera#autoUpdate | autoUpdate}, or skip your own `update()` calls. Undo both when you switch back.

If you destroy the view's camera, or the model it came from, assign another camera before the view next draws, or that draw throws.

## Framing a model

{@link View3D.from} builds a view around a loaded glTF file and gives it a camera, as [Loading models](../../assets/__docs__/models.md#showing-one-model-on-its-own) covers. To frame a model in a view of your own, wrap it in a {@link Sphere} and back the camera off until the sphere fits. {@link Container3D#getLocalBounds | getLocalBounds} measures the model without its own position, rotation and scale or its parents', so the snippet applies {@link Container3D#getGlobalTransform | getGlobalTransform} to move the sphere to where the model really is:

```ts
import { Sphere } from '@pixi/3d';

const camera = view3d.camera;
const sphere = new Sphere().setFromBox(model.getLocalBounds()).applyMatrix4(model.getGlobalTransform());
const { center, radius } = sphere;
// Half of the narrower field of view: the vertical one, or the horizontal one on a portrait screen
const aspect = app.screen.width / app.screen.height;
const halfFov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.min(1, aspect));
const distance = radius / Math.sin(halfFov);

// Any direction works at that distance; this one looks down from about 30 degrees
camera.position.set(center.x, center.y + distance * 0.5, center.z + distance * 0.87);
camera.lookAt(center);

// Models come at any size, so near and far follow the distance
camera.near = distance / 100;
camera.far = distance * 100;
```

`app.screen` has the view's shape when the view fills the screen; for a view of a set size, use its `width` and `height`. With an `OrbitCamera`, copy `center` into its {@link OrbitCamera#target | target} rather than calling `lookAt`, and set its {@link OrbitCamera#minDistance | minDistance} and {@link OrbitCamera#maxDistance | maxDistance} from the model, such as `radius` and `distance * 5`. The controller keeps the camera between them, so limits sized for another scene pull it in or push it out.

## Next steps

- [Camera controls](../../extras/__docs__/camera-controls.md): orbit and first-person controllers.
- [Second cameras](./second-cameras.md): the scene from a second camera, drawn into a texture for a monitor or a portal.
- [View3D and the 2D/3D bridge](../../__docs__/concepts/view3d.md): {@link View3D#worldToScreen | worldToScreen} and {@link View3D#screenToRay | screenToRay}, which convert between the screen and the scene through the view's camera.
