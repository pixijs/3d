---
title: Light it
---

In this step you'll light the scene from the sky and from a sun, and give the ball a material that responds to light.

Keep working in `addView` in `view.ts`.

## Light from the sky

Pass the same `sky` to the view as its {@link View3D#environment | environment} too:

```ts
const view3d = new View3D({ autoResize: true, background: sky, environment: sky });
```

`background` only paints the sky behind the scene. `environment` lights the scene from its surroundings: a surface facing up takes the sky colour, one facing down takes the ground colour, and the ones in between blend the two. With one object for both, the light on the shapes matches what's behind them. A {@link Hemisphere} casts no shadows. [Environment and IBL](../../../../src/scene/__docs__/environment.md#a-cube-map) covers lighting from an image instead.

## Give the ball a lit material

{@link Material3D} is the standard material for lit surfaces: it shades a surface from the environment and the lights. Swap it in for the ball's material:

```ts
const ball = new Mesh3D({
  geometry: new SphereGeometry({ radius: 1.5 }),
  material: new Material3D({ baseColor: 0xe91e63, roughness: 0.55 }),
});
```

The disc turns into a ball, pale on top where it faces the sky and darker underneath where it faces the violet ground. `roughness` sets how shiny the surface is; the next step explains it.

## Add a sun

A {@link DirectionalLight} shines from one direction everywhere in the scene, like the sun. Add one where the starting code marks the spot:

```ts
const sun = new DirectionalLight({ intensity: 1.5, castShadow: true });

sun.position.set(-4, 6, 8);
view3d.root.addChild(sun);
sun.lookAt({ x: 0, y: 0, z: 0 });
```

A directional light shines along its own -Z axis, and {@link Container3D#lookAt | lookAt} turns that axis toward a point. Here the light shines from above the scene, to the left and in front, at its middle. Only the direction counts, so the position only sets where `lookAt` aims from.

## See a shadow

{@link Light#castShadow | castShadow} turns on the light's shadow. A mesh's {@link Mesh3D#castShadow | castShadow} and {@link Mesh3D#receiveShadow | receiveShadow} are on by default, so a shadow only needs something in the light's way. Put a small ball between the sun and the big one:

```ts
const moon = new Mesh3D({
  geometry: new SphereGeometry({ radius: 0.4 }),
  material: new Material3D({ baseColor: 0x38bdf8, roughness: 0.55 }),
});

moon.position.set(-1, 1.5, 2);
view3d.root.addChild(moon);
```

Its soft shadow lands on the upper left of the pink ball. Next, you'll swap both balls for a set of clay shapes.
