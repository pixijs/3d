---
title: Light it with a sky
---

A photo of a real place makes good light for a model: every surface picks up the colours around it, and shiny ones reflect them. In this step you'll load one, light the scene with it and show it behind the scene.

## Load a cube map

A cube map is six square photos, one for each side of a cube around the scene. This one comes as a `.cubemap` file, a short JSON file that lists the six images. Importing `@pixi/3d` adds a loader for it to `Assets`, so it loads like any other asset. `SKY_URL`, at the top of `index.ts`, points at a sunset in Venice.

Load it where the starting code marks the spot, before the view:

```ts
const sky = await Assets.load(SKY_URL);
```

## Use it twice

Then change the line that creates the view, to give it the sky twice:

```ts
const view3d = new View3D({ autoResize: true, environment: sky, background: sky });
```

- {@link View3D#environment | environment} lights the scene from all around with the sky, and gives shiny surfaces something to reflect.
- {@link View3D#background | background} draws the sky behind the scene. With the same cube map for both, the light on the balls matches the place behind them.

The mirror ball now reflects the street and the sky, and the side of the pink ball that faces away from the sun, black before, takes light from the sky too. [A sky and ground gradient](../../../../src/scene/__docs__/environment.md#a-sky-and-ground-gradient) is another way to light a scene. In the next step the fox takes the balls' place.
