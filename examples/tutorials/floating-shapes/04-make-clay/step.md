---
title: Make clay
---

In this step you'll make the scene's shapes: six basic shapes, or primitives, in four colours, looking like soft clay.

`view.ts` no longer adds the test balls, and `addView` returns the view it makes. `index.ts` lines up whatever `createClay` in `clay.ts` returns in two rows, so you can see each shape as you make it.

## Mix the materials

Fill in `createMaterials`, which makes one material for each of the four `colors`:

```ts
function createMaterials(flatShading) {
  return colors.map(
    (color) =>
      new Material3D({
        baseColor: color,
        roughness: 0.55,
        clearcoat: { factor: 0.4, roughness: 0.25 },
        flatShading,
      }),
  );
}
```

- {@link Material3DOptions#roughness | roughness} runs from 0, mirror-smooth, to 1, fully rough. At 0.55 the light spreads into a soft, wide highlight.
- A `Material3D` is a non-metal by default, like clay; {@link Material3DOptions#metallic | metallic} at 1 would make it a metal.
- {@link Material3DOptions#clearcoat | clearcoat} adds a thin clear layer on top, like a glaze, with a highlight of its own. `factor` sets how strong the coat is, and `roughness` how blurry its highlight is.
- {@link BaseMaterial3DOptions#flatShading | flatShading} lights each triangle as one flat face, instead of blending the light smoothly across them. It suits shapes with sharp edges.

`flatShading` is fixed when you make a material, so `createClay` asks for two sets: `smooth` and `faceted`. [Materials](../../../../src/materials/__docs__/materials.md#whats-fixed-when-you-create-a-material) lists the other options that are fixed.

## Shape the geometry

A geometry is the shape a mesh draws: points, and the triangles between them. PixiJS 3D has a class for each common primitive. Fill in the list `createClay` returns, one entry per shape with the materials that suit it:

```ts
export function createClay() {
  const smooth = createMaterials(false);
  const faceted = createMaterials(true);

  return [
    {
      geometry: new TorusGeometry({ radius: 0.5, tube: 0.24, radialSegments: 24, tubularSegments: 64 }),
      materials: smooth,
    },
    { geometry: new CapsuleGeometry({ radius: 0.32, height: 1.4 }), materials: smooth },
    { geometry: new CubeGeometry({ width: 0.9, height: 0.9, depth: 0.9 }), materials: smooth },
    { geometry: new SphereGeometry({ radius: 0.6, widthSegments: 48, heightSegments: 32 }), materials: smooth },
    { geometry: new IcosahedronGeometry({ radius: 0.7 }), materials: faceted },
    { geometry: new ConeGeometry({ radius: 0.7, height: 1.1, radialSegments: 3 }), materials: faceted },
  ];
}
```

- Sizes are in world units, the same units as the camera's distance of 10. Each shape is 0.9 to 1.5 units across.
- Segments, such as the `widthSegments` and `heightSegments` of a {@link SphereGeometry}, set how many pieces a curve is made of. More give a smoother outline and cost more points to draw.
- An {@link IcosahedronGeometry} has 20 triangular faces, and the faceted materials show each one.
- A {@link ConeGeometry} with three `radialSegments` has three sides, which makes it a pyramid.

[Geometry](../../../../src/geometry/__docs__/geometry.md#built-in-shapes) lists every primitive.

The preview shows the six shapes in two rows, tilted so you see more than one side. Meshes can share a geometry and a material, so in the next step 14 shapes need only these six geometries and eight materials.
