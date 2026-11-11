# Theme kit visuals

Every teaching visual in the theme kit, each on a clay subject and named by its class. It shows the kit's own
helpers, the scaffolding other examples draw their lessons with, rather than an engine feature: fourteen stations hold
the 3D helpers, and the fifteenth the 2D overlays, a dashed screen-space ring round a ball and the label layer that
draws every name tag. An inset view under the pane films the lens station, and `examples/shared/theme/README.md`
documents each piece.

![Fifteen stations in three rows on the light checker floor, each tagged with its class names: PathHelper round an orbiting moon, LightHelper's orange cone under a spot, FrustumHelper from a camera glyph to a pyramid, SkeletonHelper's bones through a fox, its head bone in pink, GridHelper and DimensionHelper on a block; AxesHelper and AngleHelper on a turning cube, BoxHelper and GhostHelper on a leaning capsule, DotHelper and ArrowHelper on a ball, RingHelper on a puck, PointsHelper on a gem; WireframeHelper on a torus, NormalsHelper on a pill, TriangleHelper on an icosahedron, SphereHelper round an octahedron, and ScreenLines and LabelLayer on a ball circled by a dashed pink ring; an inset titled InsetView in the bottom right shows the lens camera's view of the pyramid, and the pane shows four folded folders](reference.png)

## API

- `View3D` and its `camera`, and `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Assets.load` from `pixi.js`: loads the fox's glTF as a `Scene3DSource`, whose `materials` the gallery sets to
  `roughness` 1. `Model3D` with `autoPlay: 'Survey'` and `autoUpdate: false` plays it, with `player.update(ticker)` in
  the tick, and its `skeletons[0]` is what `SkeletonHelper` draws.
- `SpotLight` with `color`, `intensity`, `range`, `coneAngle` and `penumbra`: the lamp `LightHelper` traces, its
  `coneAngle` swaying.
- `Mesh3D`, `Material3D`, `IcosahedronGeometry` and `Container3D`: the clay subjects, each station a root that a layout
  moves whole. The capsule's `origin` makes it lean about its foot.
- `Camera3D`: the inset's lens camera, which `FrustumHelper` draws. `Sphere` and `Vector3` give `SphereHelper` its
  volume, and `worldToScreen` sizes the screen-space ring round the ball. `PointData3D` types each layout's centre.
- `Container`, `Point`, `Rectangle` and `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: switches the theme, and shows or hides each visual by its class name in four folders, `Helpers`,
  `Lines and points`, `Mesh and scene` and `Overlays`, one open at a time.

## Files

- `index.ts`: the page: the view, the fox's load, a layout for the screen's shape, and the tick.
- `scene.ts`: the fifteen stations of clay, and the motion that keeps every visual moving.
- `layouts.ts`: the stations' grids for wide, compact and tall screens, and the camera framing beside the pane and the
  inset.
- `visuals.ts`: builds every visual and hands each to the pane by name.
- `helperVisuals.ts`: the axes, angle, box frame, ghost, dot, arrow, ring, path, grid, span and points.
- `meshVisuals.ts`: the wireframe, normals, struck triangle, bounding sphere, light cone, view volume and skeleton.
- `overlayVisuals.ts`: the inset view and the screen-space ring.
- `nameTags.ts`: the class-name tags stacked in front of each station.
- `controls.ts`: the pane's folders.

From the theme kit (`examples/shared/theme/README.md`): every helper, `AxesHelper`, `AngleHelper`, `BoxHelper`,
`GhostHelper`, `DotHelper`, `ArrowHelper`, `RingHelper`, `PathHelper`, `GridHelper`, `DimensionHelper`,
`PointsHelper`, `WireframeHelper`, `NormalsHelper`, `TriangleHelper`, `SphereHelper`, `LightHelper`, `FrustumHelper`
and `SkeletonHelper`; the overlays `InsetView`, `ScreenLines`, `LabelLayer` and `Label`; `clayGeometry`,
`clayMaterial`, `ThemeStage`, `ThemePane` and `LoadingScreen`.

## See also

- [Hello cube](../start_hello-cube/README.md): `LightHelper`, `WireframeHelper` and an `InsetView` in a lesson.
- [Screen and world](../2d3d_coordinates/README.md): a side view built from `InsetView`, `FrustumHelper` and
  `ScreenLines`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- theme-kit-visuals` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
