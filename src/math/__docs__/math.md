---
title: Math
description: Vectors, quaternions, matrices and shapes for 3D, where their methods put results, and seeded random numbers.
category: maths
---

# Math

PixiJS 3D has its own math classes, all exported from `@pixi/3d`: {@link Vector3} for points and directions, {@link Quaternion} for rotations, {@link Matrix4} for transforms, and shapes such as {@link Ray}, {@link Plane}, {@link Box} and {@link Sphere} for hit tests and bounds. Their methods, and those of {@link Vector2} and {@link Vector4}, follow the same few rules.

## Where results go

A method such as `add`, `normalize` or `applyMatrix4` changes the object you call it on and returns it, so calls chain. Most such methods also take an `out` object as their last argument. Pass one, and the result goes there instead, leaving the object you called as it was:

```ts
import { Vector3 } from '@pixi/3d';

const a = new Vector3(1, 0, 0);
const b = new Vector3(0, 1, 0);
const sum = new Vector3();

a.add(b); // a is now (1, 1, 0)
a.add(b, sum); // sum is (1, 2, 0), and a is still (1, 1, 0)
```

PixiJS's 2D math extras work the other way round: there, `point.add(other)` returns a new point. Here, `enemy.position.add(step)` moves the enemy.

A method whose result is another kind of object, such as {@link Ray#intersectPlane} or {@link Box#getCenter}, takes an `out` too, and without one creates a new object for each result. So do methods of a node (any object in the 3D scene) or a view that return a point or a ray, such as {@link Container3D#getGlobalPosition | getGlobalPosition} and {@link View3D#screenToRay | screenToRay}.

Where a method reads a point, any object with `x`, `y` and `z` works ({@link PointData3D}), such as a node's `position` or a plain `{ x: 0, y: 1, z: 0 }`.

## Code that runs every frame

Each object you create and drop in a frame, whether with `new Vector3()` or from a method, is garbage the browser collects later, which can stutter the frame rate. In a ticker callback or a pointer listener, create what you need once, outside it, and pass it as `out`. Here an enemy chases the player at two units a second. Both sit under the same parent, so their positions are in the same space:

```ts
const toPlayer = new Vector3();

app.ticker.add((ticker) => {
  player.position.subtract(enemy.position, toPlayer).normalize(); // the direction, length 1
  enemy.position.addScaledVector(toPlayer, 2 * (ticker.deltaMS / 1000));
});
```

A node's {@link Container3D#position | position}, {@link Container3D#rotation | rotation} and {@link Container3D#scale | scale} are {@link ObservableVector3}s, and its {@link Container3D#quaternion | quaternion} is an {@link ObservableQuaternion}. They have the same methods as `Vector3` and `Quaternion`. To keep a copy, use `new Vector3().copyFrom(node.position)`: {@link ObservableVector3#clone | clone} returns a vector still tied to the node, which marks the node changed each time you write to it.

## Rotations

A {@link Quaternion} holds a rotation as four numbers that you don't work out yourself. {@link Quaternion#setFromAxisAngle | setFromAxisAngle} builds a turn by some angle around an axis, given as a direction of length 1, and multiplying two quaternions puts their turns together. [Scene graph and transforms](../../__docs__/concepts/scene-graph.md#rotation-and-quaternion) covers when a node uses its `quaternion` and when its `rotation`.

On a node, {@link ObservableQuaternion#multiply | multiply} adds a turn around the node's own axes, which turn with it, and {@link ObservableQuaternion#premultiply | premultiply} adds it around its parent's axes. Multiplying is how you turn a node inside a loaded model further, since the file's rotation is in the node's quaternion. To lean a car's body, copy its quaternion once after loading and start each frame again from that copy, so the lean doesn't add up:

```ts
const body = car.getChildByLabel('body', true)!;
const rest = new Quaternion().copyFrom(body.quaternion); // the turn the file gave the body
const roll = new Quaternion();
const forward = { x: 0, y: 0, z: 1 };

app.ticker.add(() => {
  roll.setFromAxisAngle(forward, lean); // lean: an angle in radians that your code works out
  body.quaternion.copyFrom(rest).multiply(roll); // around the body's own z axis
});
```

For a turn that keeps going, such as a spinning wheel, size the turn by the frame's time and multiply it on each frame: `spin.setFromAxisAngle(axle, speed * (ticker.deltaMS / 1000))`, then `wheel.quaternion.multiply(spin)`.

{@link Quaternion#slerp | slerp} moves part of the way from one rotation toward another, the shorter way round. Easing a car toward a new heading by its angle instead means keeping the gap between -180° and 180°, or the car spins the long way round. A slerp needs no wrapping:

```ts
const up = { x: 0, y: 1, z: 0 };
const heading = new Quaternion();

app.ticker.add((ticker) => {
  heading.setFromAxisAngle(up, targetYaw);
  // close the same share of the gap each second, whatever the frame rate
  car.quaternion.slerp(heading, 1 - Math.exp(-3 * (ticker.deltaMS / 1000)));
});
```

On a node you turn with `multiply`, `slerp` or another quaternion method, set its other turns through the quaternion too, such as its starting turn with `setFromAxisAngle`, rather than through `rotation`.

## Matrices

Most code needs no matrix of its own. Each node keeps its {@link Container3D#worldTransform | worldTransform}, the matrix that places it in the world. The view updates it when it draws, so it can be out of date, such as right after you add or move the node. {@link Container3D#getGlobalTransform | getGlobalTransform} works out a current one. [Scene graph](../../__docs__/concepts/scene-graph.md#when-world-transforms-update) says when each fits. {@link Container3D#toGlobal | toGlobal} and {@link Container3D#toLocal | toLocal} move points between spaces.

You build a {@link Matrix4} to place each mesh in a {@link BatchedMesh3D}, which draws many meshes from one node, as [Batched meshes](../../scene/__docs__/batched-mesh.md#filling-the-slots) does with {@link Matrix4#compose | compose}, or to move a shape between spaces, as below. Two things to know:

- In `a.multiply(b)`, `b` applies to a point first.
- {@link Matrix4#getInverse | getInverse(m)} sets the matrix you call it on to the inverse of `m`, the matrix that undoes `m`.

## Shapes

- A {@link Ray} starts at its `origin` and runs along its {@link Ray#direction | direction}. Keep the direction at length 1, and `normalize()` it after you set it yourself, since the sphere tests and distances assume it. {@link View3D#screenToRay | screenToRay} builds one through a point on the screen. To find the node under that point, use pointer events or {@link View3D#raycast | raycast}; [Interaction](../../events/__docs__/interaction.md#picking-without-events) covers both.
- A {@link Plane} is a flat surface that goes on for ever. [View3D](../../__docs__/concepts/view3d.md#from-the-screen-into-the-3d-world) uses one to find the ground under the pointer.
- A {@link Box} is lined up with the axes, from its `min` corner to its `max` corner. {@link Container3D#getLocalBounds | getLocalBounds} measures a node as one.
- A {@link Sphere} is a centre and a radius. A mesh's {@link Mesh3D#boundingSphere | boundingSphere} is one. [Meshes](../../scene/__docs__/meshes.md#bounding-sphere) shows how to test it against the camera's {@link Camera3D#frustum | frustum}, the volume the camera sees.

A shape keeps the vectors you pass to its constructor, so `new Sphere(enemy.position, 2)` shares the enemy's position, and moving the sphere moves the enemy. Pass new vectors instead, such as `new Vector3().copyFrom(enemy.position)`.

Each shape is in some space. A ray from `screenToRay` and a mesh's `boundingSphere` are in world space, while `getLocalBounds` and a geometry's {@link Geometry3D#bounds3D | bounds3D} are in the node's own space. Move one into the other's space before you test them:

- `applyMatrix4` with the node's world matrix takes a shape from the node's space to world space. A turned box grows on the way, since {@link Box#applyMatrix4} fits a box lined up with the world axes around it. Give `bounds3D` a box to write into, as in `mesh.geometry.bounds3D.applyMatrix4(mesh.worldTransform, worldBounds)`. Without one, it changes the geometry's own bounds, which pointer events, `raycast` and every mesh that shares the geometry read.
- For an exact test, move the ray into the node's space instead, with `ray.applyMatrix4(inverse.getInverse(mesh.worldTransform), localRay)`, where `inverse` and `localRay` are a `Matrix4` and a `Ray` you create once. Writing into `localRay` keeps `ray` in world space for the next node. {@link Ray#applyMatrix4} keeps the direction at length 1, so under scale a distance along the moved ray isn't a world distance. To compare hits on several nodes, take each hit point back to world space with `applyMatrix4(mesh.worldTransform)`.

## Seeded random numbers

{@link seededRandom} returns a function to call in place of `Math.random`. The same seed gives the same numbers in the same order, so a scene laid out with it comes out the same on every load. The seed is a string. Here each level scatters its trees the same way every time:

```ts
const random = seededRandom(`level-${level}`);

for (const tree of trees) {
  tree.position.set((random() - 0.5) * 200, 0, (random() - 0.5) * 200);
  tree.rotation.y = random() * Math.PI * 2;
}
```

A particle system takes one through its {@link ParticleSystem3DOptions#createRandom | createRandom} option, as a function that makes it, such as `() => seededRandom('stream')` in [Bursts on demand](/3d/examples?example=particles_spawn). [Particles](../../extras/__docs__/particles.md#controlling-a-system) covers what that repeats.

## Next steps

- [Scene graph and transforms](../../__docs__/concepts/scene-graph.md): positions, rotations and the spaces nodes live in.
- [View3D and the 2D/3D bridge](../../__docs__/concepts/view3d.md): from the screen to rays and points in the world, and back.
- [Interaction](../../events/__docs__/interaction.md): hit volumes and picking.
