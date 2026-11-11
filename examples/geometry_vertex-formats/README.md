# Vertex formats

An attribute's format says how its bytes become shader values. Two spheres turn side by side with the same pink to
blue vertex colours: the left one stores every attribute as floats, the right one as packed integers, which the GPU
reads back as -1 to 1 or 0 to 1, so it draws the same from half the bytes. `interleave` changes the layout, one
buffer or one per attribute, but not the bytes.

![Two matching spheres turning over the light checker floor, each shaded pink on the left fading to blue on the right, tagged Float32 and Packed integers; the pane in the top right shows interleave and Turn ticked, Float32 15600 bytes, 4 buffers and Packed integers 7800 bytes, 1 buffer](reference.png)

## API

- `Geometry3D` with an attribute given as `{ buffer, format }`: the packed sphere's `positions` and `normals` are
  `snorm16x4`, signed 16-bit integers read as -1 to 1, and its `uvs` are `unorm16x2`, unsigned ones read as 0 to 1.
  WebGPU has no three-component 16-bit format, so xyz takes four shorts with the fourth left at 0.
- `Geometry3D` `colors` as a `Uint8Array`: integer colours are read as 0 to 1 without naming a format.
- `Geometry3D` `bounds3D`: a `Box` of two `Vector3` corners, -1 to 1, since only float positions are scanned for the
  box.
- `Geometry3D` `interleave`: one buffer for every attribute, or one each. It's fixed at construction, so the pane's
  row builds a new geometry and frees the old one with `destroy(true)`.
- `Geometry3D` `dynamic: true` on both spheres, only so they draw from their own buffers and `interleave` reaches the
  GPU. A static mesh gets the same savings, since the shared buffers it's copied into keep each attribute's format,
  and it keeps frustum culling and the shadow fit a dynamic geometry loses.
- `Geometry3D` `quantizeNormals: false`: keeps the float sphere's normals as floats, so it stays all floats.
- `geometry.attributes`: each `attribute.buffer` and its `data.byteLength`, summed for the pane's byte counts.
- `SphereGeometry` (`widthSegments`, `heightSegments`): the source of the arrays, copied out with its `vertexCount`
  and destroyed.
- `Material3D` with `roughness` and `vertexColors` on: one material on both spheres.
- `Mesh3D` with `geometry`, `material`, `position` and `parent`, turned through `rotation.y`.
- `Box.fromCenterSize` pins `stage.key.shadow.bounds` round the spheres, since dynamic geometry has no bounds to fit.
- `View3D`: the 3D scene inside pixi's stage, built at the screen's `width` and `height`, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`; `Buffer` with `BufferUsage.VERTEX`, from `pixi.js`, wraps each packed array so its
  attribute can name a format.

## Controls

- Drag to orbit.
- Pane: `interleave` stores the packed sphere in one buffer or four; `Turn` stops and starts the spin; the read-only
  `Float32` and `Packed integers` rows show each sphere's vertex bytes and buffer count.

## Files

- `index.ts`: the lesson. Packing the arrays, both geometries, the byte counts and the pane.
- `visuals.ts`: the name over each sphere, since the two look the same.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `LabelLayer`, `ThemePane`, `LoadingScreen`
and `fitPortrait`.

## See also

- [Geometry from arrays](../geometry_custom/README.md): a geometry built from float arrays, and `dynamic` rewrites.
- [Vertex colours and custom attributes](../geometry_vertex-data/README.md): `colors`, `colors1` and an attribute of
  your own with its own format.
- [Tangent space](../geometry_tangent-space/README.md): tangents, which are packed as 16-bit integers by default.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_vertex-formats` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
