# Lines and points

A geometry's `topology` says how it joins its vertices, and `indexCount` draws only the first part of its index list.
A pink figure-eight of 200 vertices lies on the floor as a `'line-list'`, drawn 45% of the way round from vertex 0,
with the rest of the path as a grey ghost; behind it a torus built as triangles draws as a cloud of points, because
its material's `topology` wins over its geometry's. Lines and points are one pixel wide at any distance: the close-up
of vertex 0 shows the line still 1 px beside a dot with a size in the world.

![The pink figure-eight path on the dark checker floor, drawn from the pale dot tagged vertex 0 on its left end round to a pink dot on its right lobe, with the undrawn rest of the loop as a thin pale grey line, and a tilted purple torus of tiny dots floating behind it; under the pane, an inset titled vertex 0, up close shows a large pale dot with the 1 px pink line leaving it; the pane shows Theme Dark, topology line-list, Drawn 45%, dynamic ticked, indexCount 180 and Torus material's topology](reference.png)

## API

- `Geometry3D` `topology`: `'line-list'` reads `indices` in pairs and draws a segment for each (0 1, 1 2 … and 199 0
  closes the loop); `'point-list'`, built with no `indices`, draws each vertex once, in order, as a dot.
- `Geometry3D` `indexCount`: how many indices to draw, in whole segments or points. Only a `dynamic` geometry honours
  it; a fixed one draws its whole index list, so the example builds both kinds of each topology up front and swaps
  the mesh's `geometry`. `path.invalidate()` after a new count works round an engine bug where the batcher misses it.
- `Material3D` `topology`: wins over the geometry's, so the torus's material set to `'point-list'` draws the
  triangle list as its vertices; the other material has none, so the triangles draw.
- `Material3D` built from the kit's `flatOptions`: an unlit colour (black `baseColor`, `emissive` colour, `fog`
  off) for the pink path and the purple torus.
- `TorusGeometry` (`radius`, `tube`, `radialSegments`, `tubularSegments`): the torus, turning slowly.
- `Mesh3D` with `geometry`, `material`, `position`, `rotation` and `parent`, and its `geometry` and `material`
  swapped by the pane. `visuals.ts` draws the ghost as a second `Mesh3D` on the fixed geometry.
- `stage.key.castShadow = false`: lines and points have no surface to cast from.
- `Vector3`, `PointData3D` and the inset's camera `lookAt` in `closeUp.ts`: the camera a hand's width from vertex 0.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with `zoomToCursor` so scrolling in keeps the path in view.
- `Application` from `pixi.js`; `Point` and `Rectangle` from `pixi.js` place the close-up and its dots.

## Controls

- Drag to orbit; scroll to zoom in towards the pointer.
- Pane: `topology` switches the path between `line-list` and `point-list`; `Drawn` sets the share of the path
  drawn, and the read-only `indexCount` shows the count that gives; `dynamic` switches to the fixed geometry, which
  ignores `indexCount` and draws the whole path; `Torus` draws the torus with its `material's topology` or its
  `geometry's topology`.
- The page opens on the dark theme unless `?theme=` says otherwise.

## Files

- `index.ts`: the lesson. The path's geometries, `indexCount`, the torus's two materials and the pane.
- `scene.ts`: the figure-eight, its vertices evenly spaced along it, and the two topologies it draws as.
- `visuals.ts`: the ghost of the undrawn path, the dots on vertex 0 and the last vertex drawn, and the tag.
- `closeUp.ts`: the inset view of vertex 0, with the dots drawn over it at their world size.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with bigger checks, `flatOptions` and
`helperMaterial`, `PointsHelper`, `InsetView`, `ScreenLines`, `LabelLayer`, `ThemePane`, `LoadingScreen` and
`fitPortrait`.

## See also

- [Geometry from arrays](../geometry_custom/README.md): building a geometry's arrays yourself, and rewriting them
  every frame.
- [Built-in shapes](../geometry_shapes/README.md): the shapes the engine builds, the torus among them.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the dark theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_lines-and-points` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
