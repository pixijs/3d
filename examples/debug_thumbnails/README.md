# Geometry thumbnails

Small pictures of geometry for an asset browser, with `GeometryThumbnailGenerator`. `getThumbnail(geometry)` draws a
geometry on the CPU into a `size` × `size` canvas, from one fixed angle in one steel blue, whatever the mesh's
material or transform, and caches it by `geometry.uid`, so meshes that share a geometry share a thumbnail. The picture
shows nine clay meshes in an arc over an asset shelf with one tile per geometry: the two cubes share a tile, and the
knot's tile names a reason instead of a picture, since at 512 segments it's past the generator's triangle limit.

![Nine clay meshes in an arc on the light checker floor, a pink cube, a pale pink capsule, a purple sphere, a lilac puck, a sky cube, a pale sky pyramid, an orange octahedron, a white torus and a pink torus knot; along the bottom an asset shelf of eight tiles shows each geometry in steel blue over its name and triangle count, starting with cube ×2, and the knot's tile reads too-many-triangles over 24,576 tris; the pane in the top right shows size 128 and Knot detail 512](reference.png)

## API

- `GeometryThumbnailGenerator` from `@pixi/3d/extras`, with `size`: `getThumbnail(geometry)` returns `'ready'` with a
  `canvas`, or `'unsupported'` with a `reason`, and the cache keeps either, so asking again costs a map lookup. `size`
  is fixed per generator, so a new size is a new generator. `prune(ids)` drops every entry whose uid isn't in the set,
  here the old knot's after a rebuild; `clear()` empties a generator you keep. `GraphDebugOverlay` draws its geometry
  cards with this generator.
- `Geometry3D` with its `uid`, the cache key, and `destroy(true)`, which frees the old knot's buffers too.
- `TorusKnotGeometry` with `tubularSegments` and `radialSegments`: the knot, rebuilt as a new geometry with a new uid
  when its detail changes.
- `Mesh3D` and `Container3D`: the arc of meshes under one root. `View3D`, and `OrbitCamera` from `@pixi/3d/extras`.
- `CanvasSource` and `Texture` from `pixi.js`: each tile's texture over a thumbnail's canvas, with `dynamic: true` since
  its size follows the canvas, and its own source rather than `Texture.from(canvas)`, which would keep it in pixi's
  `Cache`. A later picture swaps `source.resource` and calls `source.update()`; `scaleMode` `'nearest'` shows a small
  canvas's own pixels.
- `Sprite`, `BitmapText`, `Container`, `Graphics`, `Rectangle` and `PointData` from `pixi.js`: the shelf's tiles.
  `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `size` picks the thumbnail size, 16 to 256 px, and swaps in a new generator; `Knot detail` sets the knot's
  `tubularSegments` and rebuilds it on release. Past the triangle limit its tile shows the reason instead of a picture.

## Files

- `index.ts`: the lesson. The generator, each tile's texture, a new size, and the knot's rebuild and prune.
- `scene.ts`: the nine clay meshes in an arc, two rows on a phone, and the knot's geometry.
- `AssetShelf.ts`: the 2D shelf docked along the bottom, one tile per geometry.
- `ShelfTile.ts`: one tile, with its picture or its reason, its name and its triangle count.

From the theme kit (`examples/shared/theme/README.md`): `Panel` under the shelf, `ScreenLines`, `clayGeometry`,
`clayMaterial`, `ThemeStage`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Seeing the frame](../debug_graph-overlay/README.md): the overlay whose geometry cards use this generator.
- [Built-in shapes](../geometry_shapes/README.md): the geometry classes, `TorusKnotGeometry` among them.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- debug_thumbnails` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
