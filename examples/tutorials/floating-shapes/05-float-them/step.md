---
title: Float them
---

In this step you'll scatter 14 shapes around the screen and set them drifting.

`index.ts` now calls `addShapes` in `shapes.ts` instead of lining the shapes up. Work in `addShapes`: it gets the application, the view, how many shapes to make and a seed for the random numbers. `clay` already holds what `createClay` returns.

## Random, but the same every time

{@link seededRandom} returns a function that works like `Math.random`, except that the same seed always gives the same numbers, so the shapes land in the same places on every reload:

```ts
const random = seededRandom(seed);
```

## Make the floats

Each shape is a {@link Mesh3D} inside a {@link Container3D}. A `Container3D` draws nothing itself; it holds children, and moving it moves them, as a `Container` does in 2D. Here the container carries its shape around the screen while the mesh inside spins, and neither motion has to know about the other.

```ts
const floats = Array.from({ length: count }, (_, i) => {
  const { geometry, materials } = clay[i % clay.length];
  const mesh = new Mesh3D({ geometry, material: materials[i % materials.length] });

  mesh.rotation.set(random() * Math.PI * 2, random() * Math.PI * 2, 0);

  const float = new Container3D();

  float.addChild(mesh);
  view3d.root.addChild(float);

  const angle = (i / count) * Math.PI * 2 + random() * 0.3;
  const reach = 0.6 + random() * 0.35;

  return {
    float,
    mesh,
    x: Math.cos(angle) * reach,
    y: Math.sin(angle) * reach,
    z: (i % 2) * -1.5 + random() * 0.5,
    phase: random() * Math.PI * 2,
    spin: 0.2 + random() * 0.4,
  };
});
```

- {@link Container3D#rotation | rotation} holds angles in radians around x, y and z.
- `angle` and `reach` spread the shapes around a ring that leaves the middle of the screen clear, where you'll put a headline later. `x` and `y` aren't positions in the scene yet. They're fractions of the way from the middle of the screen to its edge, from -1 to 1, and the next section turns them into positions.
- `z` puts every other shape further back, so neighbours sit at different depths.

## Bob and spin

Move the shapes on every frame from the application's ticker, still inside `addShapes`:

```ts
let time = 0;

app.ticker.add((ticker) => {
  const seconds = ticker.deltaMS / 1000;

  time += seconds;

  const { camera } = view3d;
  const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
  const halfWidth = halfHeight * (app.screen.width / app.screen.height);
  const size = Math.min(1, halfWidth / 4);

  for (const { float, mesh, x, y, z, phase, spin } of floats) {
    float.position.set(x * halfWidth, y * halfHeight + Math.sin(time + phase) * 0.25, z);
    float.scale = size;
    mesh.rotation.x += spin * seconds;
    mesh.rotation.y += spin * 0.7 * seconds;
  }
});
```

- {@link Camera3D#fov | fov} is the angle the camera sees from the top of the screen to the bottom, in degrees. With the camera's distance it gives `halfHeight`, how far above the middle of the scene the top of the screen is, and the screen's shape then gives `halfWidth`. Scaling `x` and `y` by them fits the ring to the screen, on an upright phone or a wide monitor, and again after the window resizes.
- `size` shrinks the shapes on a narrow screen, where there's less room. Assigning one number to {@link Container3D#scale | scale} sets all three axes to it.
- `Math.sin` bobs each float up and down by a quarter of a unit, each at its own `phase`.

The shapes now drift in a loose ring around the middle of the screen, each spinning at its own pace.
