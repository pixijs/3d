# Morph targets

A geometry stores extra shapes as an offset for every vertex, and a mesh's weights blend them in:
`positions + weights[0] × morphTargets[0] + weights[1] × morphTargets[1]`. A clay sphere has two targets, a rounded
cube and a puffy five-pointed star, and the big pink blob opens at weights 0.4 and 0.6, a blend neither target shows
alone. Three small meshes below draw the same geometry held at the base and at each target, because the weights
belong to the mesh, not the geometry.

![A big pink clay blob floating over the light checker floor, shaped as a puffy star filled out towards a square, above a row of three small pale pink shapes tagged base, target 0 and target 1: a sphere, a rounded cube and a five-pointed star; the pane in the top right shows weights[0] 0.40, weights[1] 0.60 and Normal offsets ticked](reference.png)

## API

- `Geometry3D` `morphTargets`: one entry per target, each with `positions`, the offset of every vertex from the base
  `positions` in the same order (three floats a vertex), and `normals`, the same for the normals. The offsets are
  each shape's place for a vertex minus the sphere's.
- A second `Geometry3D` whose targets hold `positions` only, for the pane's comparison: without normal offsets every
  shape keeps the sphere's lighting.
- `Mesh3D` `weights`: a `Float32Array` with one number per target. The mesh keeps that very array, so the pane's
  rows write into it and the blob moves. Each preview `Mesh3D` holds its own `weights` over the shared geometry.
- `SphereGeometry` (`radius`, `widthSegments`, `heightSegments`, `quantizeNormals: false`): only the source of the
  base `positions`, `normals` and `indices`, never drawn. Unquantized, its normals are floats, three a vertex, the
  layout the normal offsets share.
- `Mesh3D` `geometry`: swapped on all four meshes by the Normal offsets row; `rotation` sways them together.
- `View3D`: the 3D scene inside pixi's stage, built at the screen's `width` and `height`, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with no pan and distance limits.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `weights[0]` and `weights[1]` set the big blob's weight for the cube and for the star; `Normal offsets` swaps
  every mesh onto the geometry whose targets carry no normal offsets, and back.
- The four meshes sway slowly about y, so the cube's side and the star's depth show.

## Files

- `index.ts`: the lesson. The base sphere's arrays, turning each shape into offsets, the two geometries, the blob,
  the previews and the pane.
- `scene.ts`: the rounded cube and the star, worked out from the sphere's vertices as positions and normals.
- `visuals.ts`: the tag under each preview naming the pose it holds.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayMaterial`, `LabelLayer`, `ThemePane`,
`LoadingScreen` and `fitPortrait`.

## See also

- [Morph targets from glTF](../animation_morph-targets/README.md): targets loaded from a file, and a clip that plays
  the weights.
- [Geometry from arrays](../geometry_custom/README.md): the base arrays a geometry is built from.
- [Built-in shapes](../geometry_shapes/README.md): `SphereGeometry` and the other shapes the engine builds.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_morph-targets` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
