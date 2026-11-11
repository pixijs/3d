---
title: Overview
description: The kinds of node a 3D scene is built from, how they fit together under a view's root, and which to use for many objects.
category: scene
children:
  - ./meshes.md
  - ./cameras.md
  - ./lights.md
  - ./sprite3d.md
  - ./batched-mesh.md
---

# Scene objects

A 3D scene is a tree of nodes under a view's {@link View3D#root | root}. Every node is a {@link Container3D}, the 3D counterpart of a 2D `Container`, so you move, turn, scale and group every kind of node the same way, as [Scene graph and transforms](../../__docs__/concepts/scene-graph.md) shows.

## The node types

- {@link Container3D} draws nothing. It groups nodes so they move together.
- {@link Mesh3D} draws a shape, its {@link Geometry3D}, with a material that decides how the surface looks. See [Meshes](./meshes.md).
- {@link Model3D} turns a glTF file, the 3D model format PixiJS 3D loads, into nodes: meshes, lights, cameras and empty containers, plus an animation {@link Model3D#player | player} when the file has animations. See [Loading models](../../assets/__docs__/models.md).
- {@link Sprite3D} draws a texture on a flat card that takes its size from the texture and, {@link Sprite3DOptions#billboardMode | by default}, turns to face the camera. See [Sprite3D](./sprite3d.md).
- {@link BatchedMesh3D} draws many meshes from one node. Each one is a slot holding a geometry, a material and a matrix that places it, with no node of its own. See [Batched meshes](./batched-mesh.md).
- {@link ParticleContainer3D} draws up to a fixed number of flat cards in one draw call, at the positions your code writes. {@link ParticleSystem3D}, from `@pixi/3d/extras`, is a particle container that emits and moves its particles on its own. See [Particles](../../extras/__docs__/particles.md).
- {@link Camera3D} is the point of view the scene is drawn from. A view comes with one, at {@link View3D#camera | view3d.camera}. See [Cameras](./cameras.md).
- {@link AmbientLight}, {@link DirectionalLight}, {@link PointLight} and {@link SpotLight} light the meshes whose material reacts to light, such as {@link Material3D}. See [Lights](./lights.md).

Light from the surroundings, such as a sky, isn't a node but the view's {@link View3D#environment | environment}; see [Environment](./environment.md).

## Putting a scene together

A 3D node isn't a 2D `Container`, so it can't go on `app.stage`. The {@link View3D} goes on the stage, and every 3D node goes under `view3d.root`, at any depth. A node that isn't under a view's root draws and lights nothing. 2D content, such as a `Text`, can't go under the root either: draw it onto a 3D surface with a {@link ContainerTexture}, as [Rendering 2D into 3D](../../core/__docs__/container-texture.md) shows, or keep it on the stage and pin it over a 3D point with {@link View3D#worldToScreen | worldToScreen}.

The view finds every mesh and light wherever it sits in the tree, so a light can carry a mesh, and a mesh a light. Here a point light carries a glowing bulb that moves with it:

```ts
import { Material3D, Mesh3D, PointLight, SphereGeometry } from '@pixi/3d';

const color = 0xff2e7e;
const light = new PointLight({ color, intensity: 8, range: 6 });
// An emissive material glows with its own colour, whatever light reaches it
const bulb = new Mesh3D({
  geometry: new SphereGeometry({ radius: 0.09 }),
  material: new Material3D({ baseColor: 0x000000, emissive: { color, strength: 4 } }),
  castShadow: false, // a glowing bulb shouldn't cast a shadow
});

light.addChild(bulb);
view3d.root.addChild(light);

app.ticker.add(() => {
  const time = performance.now() / 1000;

  light.position.set(Math.cos(time) * 2.6, 1.2, Math.sin(time) * 2.6); // the bulb moves with it
});
```

Hiding the light with {@link Container3D#visible | visible} turns its light off and hides the bulb with it.

[Scene graph and transforms](../../__docs__/concepts/scene-graph.md) covers the rest, including why the order of children no longer decides what covers what.

## Choosing a node for many objects

| You have                                                                           | Use                                                 |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| Objects you place, click and animate one by one                                    | {@link Mesh3D}                                      |
| Copies of a loaded model that each animate on their own                            | Several {@link Model3D}s built from one loaded file |
| Up to a few thousand cards that face the camera and mostly stay put, such as trees | {@link Sprite3D}                                    |
| Thousands of copies of a mesh, such as trees, rocks, stars or bullets              | {@link BatchedMesh3D}                               |
| Fire, smoke, sparks or snow that emit, move and fade on their own                  | {@link ParticleSystem3D}                            |
| Thousands of cards that your own code moves every frame                            | {@link ParticleContainer3D}                         |

Models built from one {@link Scene3DSource}, the object `Assets.load` returns for a glTF file, share its geometry, materials and textures, as [Loading models](../../assets/__docs__/models.md#a-source-and-its-models) explains. Each model has its own nodes and, when the file has animations, its own {@link AnimationPlayer}.

Each mesh and each sprite, including the meshes inside a model, is a scene node. One that moves, or sits under a node that moves, costs CPU time on every frame it moves, since the view works out its place in the world again. One that blends with what's behind it is also sorted back to front every frame, moving or not, and a sprite that makes its own material blends by default; see {@link Sprite3DOptions#alphaMode | alphaMode}.

Meshes that don't move and share their draw calls cost the CPU little each frame; [Performance](../../__docs__/concepts/performance.md#what-makes-a-draw-call) says what lets them share. Their number still counts: each node takes memory and time to build, and where the view {@link View3D#cull | culls} on the CPU, as it does by default under WebGL2, its culling work each frame grows with the count. So put scenery, such as a forest's trees and rocks, in {@link BatchedMesh3D} slots. A few thousand meshes that never move are fine, but for tens of thousands, use slots. A batched mesh and a particle container have no node per copy: moving a copy is a write into an array.

Unlike pixi's 2D `ParticleContainer`, a {@link ParticleContainer3D} has no object per particle: you write each card by its index with {@link ParticleContainer3D#writePacked | writePacked}, then {@link ParticleContainer3D#upload | upload} once a frame, as [Driving particles yourself](../../extras/__docs__/particles.md#driving-particles-yourself) shows. Its {@link ParticleContainer3D#capacity | capacity} is fixed when you create it, and writing past it throws, so build a bigger container when your particles outgrow it.

## Next steps

- [Meshes](./meshes.md): building a mesh from a geometry and a material, and sharing and swapping them.
- [Cameras](./cameras.md) and [Lights](./lights.md): seeing and lighting a scene.
- [Performance](../../__docs__/concepts/performance.md): draw calls, culling and a checklist for phones.
