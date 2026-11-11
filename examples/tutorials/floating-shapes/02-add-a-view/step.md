---
title: Add a view
---

Your application draws in 2D. To add 3D, you add a {@link View3D}: a PixiJS display object that draws a 3D scene inside its rectangle. It goes on the stage like a sprite, and everything 3D goes under its {@link View3D#root | root}.

Work inside `addView` in `view.ts`. `index.ts` calls it once the canvas is on the page.

## Create the view

```ts
const view3d = new View3D({ autoResize: true, background: sky });

app.stage.addChild(view3d);
```

- {@link View3D#autoResize | autoResize} sizes the view to the screen on every render, so it follows the canvas when the window resizes.
- {@link View3D#background | background} is what the view draws behind its scene. `sky`, at the top of `view.ts`, is a {@link Hemisphere}: a sky colour above that blends into a ground colour below. In the next step the same object lights the shapes.

## Move the camera

Every view comes with a {@link Camera3D} at {@link View3D#camera | view3d.camera}. It starts at the origin, the centre of the scene, looking along -Z, into the screen. +Y is up, as [Scene graph and transforms](../../../../src/__docs__/concepts/scene-graph.md#axes-units-and-facing) explains. Move the camera back along +Z so the origin is in front of it:

```ts
view3d.camera.position.set(0, 0, 10);
```

## Add a test shape

A {@link Mesh3D} draws a geometry, which is its shape, with a material, which is what its surface looks like. Put a sphere at the origin to check what the camera sees:

```ts
const ball = new Mesh3D({
  geometry: new SphereGeometry({ radius: 1.5 }),
  material: new FlatMaterial({ baseColor: 0xe91e63 }),
});

view3d.root.addChild(ball);
```

The preview shows a flat pink disc on a soft gradient. {@link FlatMaterial} ignores light and paints every pixel of the sphere the same colour, so nothing shows that it's round. In the next step you'll light the scene and give the ball a material that responds to light.
