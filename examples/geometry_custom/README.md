# Geometry from arrays

A mesh's shape from your own typed arrays: `positions`, `normals`, `uvs` and `indices` in a `Geometry3D`. A heightmap
patch of 16 × 16 cells floats over the floor, its clay painted with a sky-to-lilac gradient and the PixiJS wordmark so
the uvs show, and waves roll across it because the frame loop rewrites the arrays and uploads them every frame. That
works only because the geometry is `dynamic`: a static one is copied on its first draw, so with `dynamic` off the clay
holds still while the marks, which read the arrays, keep riding the waves.

![The heightmap patch floating over the light checker floor, shaded from pale sky on the left to lilac on the right with the purple wordmark across its middle, every triangle edge drawn in dark lines and one triangle filled pink with arrows along its edges and its corners tagged 216, 233 and 217; the pane in the top right shows Show indices, Height 1.00, Wave speed 1.00, Normals From slope and dynamic ticked](reference.png)

## API

- `Geometry3D` built from four arrays: `positions` and `normals` (`Float32Array`, three floats a vertex), `uvs` (two
  floats a vertex) and `indices` (a `Uint16Array`, three vertex numbers a triangle, wound counter-clockwise from above
  so each front faces up).
- `Geometry3D` `dynamic: true`: the geometry draws from its own buffers, which hold these very arrays, so after the
  frame loop rewrites them, `geometry.attributes.aPosition.buffer.update()` and `aNormal.buffer.update()` queue the
  upload. `dynamic` is fixed at construction, so switching it builds a new geometry; so does a Height or Normals
  change while it's off, since a static geometry never sees a rewrite.
- `Geometry3D` `quantizeNormals: false`: keeps the normals in the `Float32Array` the frame loop writes, rather than a
  16-bit copy the rewrites would never reach. `geometry.destroy(true)` frees the old geometry and its buffers.
- `Mesh3D` with `geometry`, `material`, `position` and `parent`; setting `terrain.geometry` swaps in the new shape.
- `Box.fromCenterSize` pins `stage.key.shadow.bounds` round the patch and its highest waves, since the key light
  can't fit its shadow to a dynamic geometry's bounds.
- `Vector3` (`fromArray`, `toArray`, `addScaledVector`) in `visuals.ts` reads the triangle's corners out of the
  arrays, and `view3d.worldToScreen` with `terrain.toGlobal` places their tags.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the sheet by `maxPolarAngle` since the clay draws
  front faces only.
- `Application`, and `CanvasSource` (with `autoGenerateMipmaps`) and `Texture` for the terrain's canvas texture, from
  `pixi.js`; `Point` from `pixi.js` holds the corners' screen positions.

## Controls

- Drag to orbit.
- Pane: `Show` picks the array the marks explain: `positions` dots every vertex, `indices` draws every triangle edge
  and numbers one triangle's corners in order, `normals` draws a hair along each normal, and `uvs` dots the vertices
  and tags `0, 0` and `1, 1` at opposite corners. The `Heightmap` folder's `Height` scales the heights, `Wave speed`
  sets how fast the waves roll (0 stops them), and `Normals` switches between `From slope` and `All up`, which lights
  the patch as a flat sheet. `dynamic` rebuilds the geometry with or without it.

## Files

- `index.ts`: the lesson. Filling the arrays, building the geometry and rebuilding it, the pane, and the rewrite and
  upload each frame.
- `heightmap.ts`: the grid's size, and the functions that write heights and normals into the arrays without
  allocating.
- `scene.ts`: the terrain's texture, a gradient along u with the wordmark reading along it.
- `visuals.ts`: the marks for each array, children of the terrain that read the arrays each frame.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `createClayMaterial` with a `baseColorTexture`,
`PointsHelper`, `WireframeHelper`, `TriangleHelper`, `PathHelper`, `NormalsHelper`, `LabelLayer`, `wordmarkSvg`,
`ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Vertex colours and custom attributes](../geometry_vertex-data/README.md): more arrays per vertex, read by the
  material and by a shader bit.
- [Lines and points](../geometry_lines-and-points/README.md): the same arrays drawn as lines and points, and
  `indexCount` to draw part of them.
- [Built-in shapes](../geometry_shapes/README.md): the geometry the engine builds for you.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_custom` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
