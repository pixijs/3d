---
title: Build the booth
---

You'll build a fairground booth at night, with targets sliding along two rails. Hit a target and it falls back in a burst of confetti, the score goes up on a board over the booth, and the round ends after 30 seconds. This tutorial assumes you've built a scene with a {@link View3D} before; [Floating Shapes](https://pixijs.com/3d/tutorials/floating-shapes) covers the basics.

The starting code sets up the stage:

- `index.ts` creates the application and a view with a crosshair cursor. A {@link Hemisphere} environment lights the scene like a dim night sky: surfaces facing up take its sky colour, and surfaces facing down its ground colour.
- `camera.ts` places the camera in front of the booth, and moves it back on narrow screens so the whole booth fits.

In this step you'll build the booth itself in `buildBooth`, in `booth.ts`.

## Materials

Start with the materials the booth is made of:

```ts
const wood = new Material3D({ baseColor: 0x9a5b34, roughness: 0.7 });
const cream = new Material3D({ baseColor: 0xf2e6cf, roughness: 0.5 });
const red = new Material3D({ baseColor: 0xd81b3c, roughness: 0.45, clearcoat: { factor: 0.6, roughness: 0.2 } });
const wall = new Material3D({ baseColor: 0x3a2c6e, roughness: 0.9 });
const brass = new Material3D({ baseColor: 0xe0b060, metallic: 1, roughness: 0.35 });

const bulb = new Material3D({ baseColor: 0xffffff, emissive: { color: 0xffc46b, strength: 2 } });
```

- {@link Material3D} is the lit material you met in Floating Shapes. `metallic: 1` makes the brass a metal, and the red paint has a glossy clear coat.
- {@link Material3DOptions#emissive | emissive} adds the material's own glow on top of the lighting, so the bulbs show even where no light reaches them. It doesn't light anything around them.
- The bulb colour's red channel is already full, so a `strength` above 1 pushes the glow past white, which matters when you add bloom in the "Add juice" step.

## Boxes and posts

Meshes can share a geometry. A {@link CubeGeometry} is 1 unit on each side {@link CubeGeometry.defaultOptions | by default}, so one cube, scaled to size, makes every box in the booth. One {@link CylinderGeometry} makes both posts. The booth stands on y = 0, and the camera looks along -z, so x runs across the booth, y up it and z toward you. A small helper makes a mesh, places it and adds it to the scene:

```ts
const cube = new CubeGeometry();
const post = new CylinderGeometry({ radiusTop: 0.14, radiusBottom: 0.14, height: 5.2, radialSegments: 24 });
const add = (geometry, material, x, y, z) => {
  const mesh = new Mesh3D({ geometry, material });

  mesh.position.set(x, y, z);
  view3d.root.addChild(mesh);

  return mesh;
};

add(cube, wall, 0, 2.5, -1.3).scale.set(9, 5, 0.2);
add(cube, wall, -4.3, 2.5, 0.1).scale.set(0.2, 5, 2.8);
add(cube, wall, 4.3, 2.5, 0.1).scale.set(0.2, 5, 2.8);
add(cube, red, 0, 0.6, 1.5).scale.set(8.8, 1.2, 0.7);
add(cube, wood, 0, 1.26, 1.45).scale.set(9.2, 0.12, 1);
add(post, cream, -4.5, 2.6, 1.6);
add(post, cream, 4.5, 2.6, 1.6);

add(cube, brass, 0, 1.6, -0.7).scale.set(8.6, 0.08, 0.08);
add(cube, brass, 0, 3.05, -0.7).scale.set(8.6, 0.08, 0.08);
```

The last two boxes are thin brass rails for the targets to run along.

## The awning

A row of stripes in alternating colours, tipped forward at the bottom, with bulbs along its edge:

```ts
for (let i = 0; i < 8; i++) {
  const stripe = add(cube, i % 2 ? cream : red, (i - 3.5) * 1.15, 5.45, 1.75);

  stripe.scale.set(1.15, 0.9, 0.06);
  stripe.rotation.x = -0.4;
}

const bulbGeometry = new SphereGeometry({ radius: 0.07, widthSegments: 12, heightSegments: 8 });

for (let i = 0; i < 9; i++) add(bulbGeometry, bulb, (i - 4) * 1.15, 5.03, 1.95);
```

Rotations are in {@link Container3D#rotation | radians}, as in 2D. A negative rotation around x tips the top of a stripe away from you.

## Spotlights

A {@link SpotLight} shines in a cone from a point, like a stage light. Put one high up on each side, in front of the booth, aimed across it to where the targets will run:

```ts
for (const side of [-1, 1]) {
  const spot = new SpotLight({
    color: 0xffe2b8,
    intensity: 50,
    range: 18,
    coneAngle: 32,
    penumbra: 0.5,
    castShadow: true,
  });

  spot.position.set(side * 3.6, 4.8, 7);
  spot.lookAt({ x: -side * 0.6, y: 2.4, z: -1.2 });
  view3d.root.addChild(spot);
}
```

- A spotlight shines along its own -z axis, so {@link Container3D#lookAt | lookAt} aims it at a point.
- Its light dims with the square of the distance, so a light about 9 units from the targets needs a much higher `intensity` than a directional light. It fades to nothing at its {@link SpotLight#range | range}.
- {@link SpotLight#coneAngle | coneAngle} is the angle from the middle of the cone to its edge, in degrees, and {@link SpotLight#penumbra | penumbra} softens the edge.
- With {@link Light#castShadow | castShadow}, each spotlight casts its own shadow. A mesh made with `new Mesh3D` casts shadows {@link Mesh3D.defaultOptions | by default}, so each target you add next throws two.

The preview shows a red and cream booth, lit warm from both sides against the night.
