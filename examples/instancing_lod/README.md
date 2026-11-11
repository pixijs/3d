# Level of detail

Level of detail in application code: each frame measures the camera's distance to a mesh and sets its `geometry` to
the sphere built for that distance, high, medium or low detail. Two flat-shaded spheres travel away and back side by
side: the pink one switches the moment it crosses a threshold, and the blue one waits until it's a hysteresis band
past one, so when the pair hovers across the first threshold the pink one flips between levels while the blue one
holds. It's a policy built from `Mesh3D.geometry`, not an engine LOD component.

![Two faceted spheres side by side over the light checker floor, a pink one tagged No band and a blue one tagged With band, both near the camera at high detail; the pane in the top right shows Animate ticked, Travel away 3.92 and Hysteresis band 1.20, and the No band and With band folders each read distance 15.2, triangles 1216 and swaps 0](reference.png)

## API

- `Mesh3D` `geometry`: set each frame to the level the distance picks. A swap rebuilds the mesh's shader and its
  store row, which is the cost the band saves near a threshold.
- `SphereGeometry` (`radius`, `widthSegments`, `heightSegments`): three levels, 32 × 20, 12 × 8 and 6 × 4, built once
  and shared by both meshes, so a level change never builds or destroys geometry. `indices.length / 3` gives each
  level's triangles.
- `Material3D` (`baseColor`, `roughness`, `flatShading`): flat facets, so each level's triangles show.
- `camera.position.distanceTo(mesh.position)`: the distance the policy reads, against thresholds at 16 and 24 units.
- `camera.zoom`: a narrow screen zooms the lens out rather than backing the camera off as the kit's `fitPortrait`
  would, since moving the camera would change every level.
- `View3D`: the 3D scene inside pixi's stage, built at the screen's `width` and `height`, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit and scroll to zoom, both of which change the distance.
- `Application` from `pixi.js`, and its renderer's `resize` event, which refits the zoom.

## Controls

- Drag to orbit and scroll to zoom; both change each sphere's distance.
- Pane: `Travel away` moves the spheres away from the camera; `Hysteresis band` sets how far past a threshold the
  blue sphere waits. The `No band` and `With band` folders read each sphere's `distance`, `triangles` and `swaps`, and
  `Reset swap counts` zeroes the swaps.
- The pair travels out to low detail and back, then hovers across the first threshold, on its own, since watching the
  levels change is the lesson. `Animate` pauses it, and moving `Travel away` pauses it too.

## Files

- `index.ts`: the lesson. The three geometries, the level policy with and without a band, and the travel.
- `controls.ts`: the pane, which pauses the travel when the reader moves it.
- `visuals.ts`: the tag on each sphere.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, the palette's `BRAND` colours, `LabelLayer`,
`ThemePane` and `LoadingScreen`.

## See also

- [Batching and culling](../instancing_batching/README.md): skipping the meshes the camera can't see at all.
- [Built-in shapes](../geometry_shapes/README.md): what a sphere's segment counts cost in vertices and triangles.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- instancing_lod` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
