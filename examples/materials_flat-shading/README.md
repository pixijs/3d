# Low-poly look

Flat shading gives each triangle one normal, for the faceted low-poly look. `flatShading: true` makes a `Material3D`
light each triangle with its own face normal instead of blending its vertex normals, and the shader works that normal
out per pixel, so the geometry stays the same and the material alone decides. A sky-blue geodesic ball stands among
four low-detail clay shapes, all faceted, and a ring of normals round the ball's outline shows the normals the material
lights with: in bundles, one bundle per face, where smooth shading fans them out evenly.

![A faceted sky-blue geodesic ball over the light checker floor, ringed by pink hairs tagged normals that stand in bundles, one bundle per face, with a faceted pink torus, lilac capsule, purple puck and orange octahedron round it; the pane in the top right shows flatShading on and detail 1](reference.png)

## API

- `Material3D` with `flatShading: true`: lights each triangle with its face normal, which the shader takes from
  screen-space derivatives, so no vertices are split. It's fixed at construction and `material.flatShading` is
  readonly, so each mesh gets a smooth and a faceted material, and `setFlatShading` swaps `mesh.material` between them.
- `IcosahedronGeometry` with `detail`: the geodesic ball, whose triangles are all about the same size, from 20 at
  detail 0 to 1,280 at detail 3. A geometry reads its options once, so a new detail builds a new geometry, and
  `destroy(true)` frees the old one's buffers.
- `Mesh3D`: the ball and the four shapes, which turn slowly so their facets catch the light.
- `Geometry3D`'s `positions`, `normals` and `indices`: `slice.ts` casts rays from the ball's centre across the plane
  facing the camera, finds the triangle each one leaves through, and keeps its face normal and its three vertex normals
  blended there. `Vector3` and `PointData3D` carry that maths.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held near the front so no shape rises into the ring.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit. Once the camera settles somewhere new, the ring is sliced again to face it.
- Pane: `flatShading` switches every mesh between its two materials, and the ring's hairs turn between face normals
  and blended ones; `detail` sets the ball's detail, from 0 to 3.

## Files

- `index.ts`: the lesson. The two looks for each mesh, the ball, the shapes, the pane and the key light's new place.
- `slice.ts`: `sliceRing()`, the ray and triangle test that finds where each hair stands and its two normals.
- `visuals.ts`: the ring of normals and its tag, turning between the two kinds of normal.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, its `key` moved further to the side;
`clayGeometry` at `'low'` detail with `ClayShape`, `ClayColor` and the `CLAY` tints; `NormalsHelper` for the ring,
`ThemePane`, `LoadingScreen`, `LabelLayer` and `fitPortrait`.

## See also

- [Built-in shapes](../geometry_shapes/README.md): `IcosahedronGeometry` among the other built-in shapes, and the
  options that subdivide them.
- [PBR, Phong and flat](../materials_lighting-models/README.md): `FlatMaterial`, which is unlit, not flat-shaded.
- [Toon shading](../materials_toon/README.md): another stylised look, with the light rounded into bands.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_flat-shading` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
