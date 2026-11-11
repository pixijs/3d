---
title: Load a model
---

In this step you'll load an animated fox from a glTF file and set the camera circling it.

The test balls are gone, and the top of `index.ts` now has `FOX_URL` as well as `SKY_URL`. Parts of the fox are under CC BY 4.0, so keep the credit in the comment above `FOX_URL` when you use it.

## Load the fox

Add the fox where the starting code marks the spot:

```ts
const source = await Assets.load(FOX_URL);
const fox = new Model3D(source);

fox.scale.set(1 / fox.height);
view3d.root.addChild(fox);
```

- Importing `@pixi/3d` also adds glTF loaders to `Assets`. A loaded file is a {@link Scene3DSource}, which models are built from: what the file holds, such as its geometry, materials, textures and animations.
- A {@link Model3D} builds the fox from the source, as a container with the file's meshes inside it.
- The file makes the fox about 80 units tall, so dividing 1 by its {@link Container3D#height | height} scales it to 1 unit tall, whatever size the file made it. Setting `fox.height = 1` would scale only y and squash the fox flat, as [Measuring and sizing](../../../../src/__docs__/concepts/scene-graph.md#measuring-and-sizing) explains.
- The fox's feet are at the model's origin, so it stands on y = 0. It faces +Z, the side you'll put the camera on.

[Loading models](../../../../src/assets/__docs__/models.md#what-a-file-can-bring) covers what else a file can bring.

## Circle it

{@link OrbitCamera}, from `@pixi/3d/extras`, turns the view's camera around a point as you drag, and zooms as you scroll or pinch. Place the camera, then create the orbit:

```ts
view3d.camera.position.set(1.4, 1.1, 2.1);
const orbit = new OrbitCamera({
  view: view3d,
  target: { x: 0, y: 0.5, z: 0 },
  enableDamping: true,
  enablePan: false,
  minDistance: 1.5,
  maxDistance: 6,
  maxPolarAngle: Math.PI / 2 - 0.1,
  autoRotate: true,
  autoRotateSpeed: 0.5,
});

if (app.screen.width < app.screen.height) orbit.zoom(0.6);
```

- The orbit starts from where the camera is, and turns it to face the {@link OrbitCamera#target | target}, halfway up the fox.
- {@link OrbitCamera#enableDamping | enableDamping} lets the camera glide to a stop after a drag. {@link OrbitCamera#enablePan | enablePan} off turns off the pan gestures, which move the target, so the fox stays in the middle.
- {@link OrbitCamera#minDistance | minDistance} and {@link OrbitCamera#maxDistance | maxDistance} limit the zoom, in the same units as the fox, which is now 1 tall.
- The {@link OrbitCamera#polarAngle | polar angle} is 0 straight above the target, so a {@link OrbitCamera#maxPolarAngle | maxPolarAngle} just under a quarter turn keeps the camera above the middle of the fox.
- {@link OrbitCamera#autoRotate | autoRotate} circles the fox on its own, at {@link OrbitCamera#autoRotateSpeed | autoRotateSpeed} turns a minute, and pauses while you drag.
- On a screen taller than it is wide, {@link OrbitCamera#zoom | zoom} with a factor below 1 steps the camera back, so the fox fits across the screen.

Drag to look around the fox. It holds still for now; next, you'll play its animations.
