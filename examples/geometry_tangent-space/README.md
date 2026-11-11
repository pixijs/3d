# Tangent space

Tangent space turns a normal map's RGB directions into directions on a mesh. Two flat tiles share one material, one
normal map of nine round pads and the same mirrored UVs; only their `tangents` differ. Each tangent is T, the way u
grows across the surface, then w, which picks the bitangent B = cross(N, T) × w: the map's red bends the normal along
T, green along B and blue out along N. Mirroring u reverses T, so w has to reverse too, or B points down the tile and
the pads light on their bottom edges, as on the right tile here.

![Two pale blue tiles with lilac rims on a plain haze backdrop, each pressed with nine round pads; a light arrow above them points down and right; the left tile, tagged correct w, lights its pads on their top-left edges, and the right one, tagged wrong w in pink, on their bottom edges; under each tile a frame of arrows marks T pointing left, N towards the camera, and B pointing up on the left tile and down on the right; the pane shows Right tile Wrong w, Mirror u ticked, left w −1, right w +1 and normalScale 1.00](reference.png)

## API

- `Geometry3D` `tangents`: four floats a vertex, T then w. The example builds the same quad of `positions`,
  `normals`, `uvs` and `indices` three ways for each set of UVs: correct w, w reversed, and no tangents, where the
  shader derives the frame per pixel from the UVs and gets w right on its own.
- `geometry.tangents`: read back for the pane's w rows. They're stored as 16-bit integers by default, so the code
  reads the sign.
- `Material3D` `normalTexture` and `normalScale`, with `baseColor` and `roughness`: one material on both tiles, so
  the tangents are the only difference.
- `Mesh3D` `geometry`: swapped by the pane, with `position` and `parent`; each tile's backing is its child.
- `DirectionalLight` (`color`, `intensity`, `position`) and `lookAt`: the one grazing light from the upper left. A
  directional light shines along its local −z, so `lookAt` sets only its direction.
- `CubeGeometry` with a `Material3D` and `Mesh3D`: the thin lilac backing behind each tile.
- `view3d.environment` (`skyColor`, `groundColor`, `intensity`): a dim fill, so the grazing light does the shading.
- `View3D`: the 3D scene inside pixi's stage, built at the screen's `width` and `height`, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept near face-on with no zoom, where a normal map's fake
  depth holds.
- `Application` from `pixi.js`; `Texture.from` from `pixi.js` turns the canvas the normal map is drawn on into a
  texture with mipmaps.

## Controls

- Drag to orbit, a little either side of face-on.
- Pane: `Right tile` gives the right tile `Wrong w`, `Correct w` or `No tangents`; `Mirror u` flips both tiles' u,
  which reverses T and w with it, so the left tile stays correct and a wrong w stays wrong; the read-only `left w`
  and `right w` show each tile's w (`none` with no tangents); `normalScale` sets how far the map bends the normals.

## Files

- `index.ts`: the lesson. The quad's arrays, the tangent sets, the shared material and the pane.
- `normalMap.ts`: the nine pads drawn as tangent-space normals on a canvas.
- `scene.ts`: the tiles' backings and the grazing light.
- `visuals.ts`: the light's ray, each tile's T, B and N arrows, and the tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false` and its floor hidden,
`LightHelper`, `ArrowHelper`, `LabelLayer`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [PBR texture set](../materials_textures/README.md): a normal map among the other PBR textures, on a model.
- [Geometry from arrays](../geometry_custom/README.md): the other arrays a geometry is built from.
- [Vertex formats](../geometry_vertex-formats/README.md): how attributes such as tangents are stored.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_tangent-space` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
