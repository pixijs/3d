---
title: Catch the shadow
---

The fox floats in front of the sky with nothing under its feet. In this step you'll put it on a round stand and give it a shadow.

`index.ts` now calls `addFloor` in `floor.ts`. Work in `addFloor` first.

## A stand

A short, wide {@link CylinderGeometry} makes a round stand:

```ts
const stand = new Mesh3D({
  geometry: new CylinderGeometry({ radiusTop: 1.15, radiusBottom: 1.2, height: 0.08, radialSegments: 96 }),
  material: new Material3D({ baseColor: 0xbdb2a6, roughness: 0.6 }),
  castShadow: false,
});

stand.position.y = -0.04;
view3d.root.addChild(stand);
```

- The fox is just under 2 units from nose to tail, so a stand 2.3 across is a little wider than the fox is long. When the fox walks or runs, the tip of its tail swings just past the rim. `radialSegments` is the number of flat sides around the edge, and 96 keeps the rim round up close.
- A cylinder is centred on its middle, so lowering it by half its height puts its top level with the fox's feet.
- A mesh you build with `new Mesh3D` casts and catches shadows by {@link Mesh3D.defaultOptions | default}. The stand only has to catch the fox's, so {@link Mesh3D#castShadow | castShadow} off stops it casting one. The sun then spreads its shadow detail over the fox alone, so the fox's shadow comes out sharper, as [Shadows](../../../../src/scene/__docs__/shadows.md#one-box-over-the-scene) explains.

## Turn on the sun's shadow

The sun from the first step lights the fox but casts no shadow yet. In `index.ts`, turn on its {@link Light#castShadow | castShadow} in the line that creates it:

```ts
const sun = new DirectionalLight({ intensity: 2, castShadow: true });
```

The fox casts a shadow because a {@link Model3D} builds meshes that cast one, unless you pass it {@link Model3DOptions#castShadow | castShadow} `false`.

The fox now stands on its stand with its shadow beside it. As the camera circles, the shadow stays put, because the sun belongs to the scene, not to the camera. [Shadows](../../../../src/scene/__docs__/shadows.md) covers sharper shadows and larger scenes.
