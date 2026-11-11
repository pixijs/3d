---
title: Add targets
---

Time for something to aim at. In this step you'll put five targets on each rail and slide them along it, the two rails in opposite directions.

`index.ts` now calls `createTargets` in `targets.ts`. At the top of that file, `COUNT` and `SPACING` set how many targets each rail has and how far apart they are. `RAILS` sets each rail's height and its targets' speed in units a second; a negative speed runs them left. The starting code also makes a target's geometry and materials:

- The face is three discs: a red one, a white ring and a red bull's-eye. Unlike in 2D, the order you add meshes in doesn't decide which shows in front: the surface nearer the camera does. So each disc is a little thicker than the one behind it, and pokes out in front.
- A thin steel `stick` holds the face up.

## A node for each rail

Each rail gets a {@link Container3D}, a 3D node that holds children as a 2D `Container` does, and its targets become its children. Fill in `createTargets`:

```ts
const targets = RAILS.flatMap((rail) => {
  const track = new Container3D();

  track.position.set(0, rail.y, -0.7);
  view3d.root.addChild(track);

  return Array.from({ length: COUNT }, (_, i) => {
    const face = new Container3D();
    const pole = new Mesh3D({ geometry: stick, material: steel });

    face.position.y = 0.95;
    face.rotation.x = Math.PI / 2;
    face.addChild(
      new Mesh3D({ geometry: outer, material: red }),
      new Mesh3D({ geometry: ring, material: white }),
      new Mesh3D({ geometry: bull, material: red }),
    );
    pole.position.y = 0.35;

    const node = new Container3D();

    node.addChild(pole, face);
    node.x = i * SPACING;
    track.addChild(node);

    const target = { node, speed: rail.speed };

    return target;
  });
});
```

- A child's position is relative to its parent, as in 2D, so a target only needs its place along the rail. The track carries it to the rail's height.
- A {@link CylinderGeometry} stands along y. A quarter turn around x turns the discs' flat faces toward the camera.
- Each target is a node of its own, with the pole and the face as children. Its origin is at its foot, on the rail, which matters in the next step, when targets fall over.
- `targets` keeps each target's node and its rail's speed, for the ticker.

## Slide them along

Move every target along its rail on each frame, and wrap it to the other end when it runs off:

```ts
const length = COUNT * SPACING;

app.ticker.add((ticker) => {
  const seconds = ticker.deltaMS / 1000;

  for (const target of targets) {
    const { node } = target;

    node.x += target.speed * seconds;
    if (node.x > length / 2) node.x -= length;
    if (node.x < -length / 2) node.x += length;
  }
});
```

The ends of the rails sit inside the side walls, so a target disappears into one wall and comes back out of the other. The lower rail runs right and the upper one left, and each target throws two shadows on the back wall.
