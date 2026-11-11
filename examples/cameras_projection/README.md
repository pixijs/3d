# Perspective and orthographic

How a camera flattens 3D onto the screen. `Camera3D` `mode` picks the projection: a perspective camera sees a pyramid
whose vertical angle is `fov`, so farther things look smaller, and an orthographic camera sees a box
`orthographicSize` wide each side of the middle, so everything keeps its size at any distance, as an isometric game
wants. The picture is a clay town block in perspective, where the sky blue house at the far corner comes out smaller
than its twin at the near corner. Depth comes from how far back the camera stands; `zoom` magnifies in either mode
without moving the camera, so it never changes depth.

![A clay town block of houses, shops, towers and trees round a courtyard on a white slab, seen from above at a diagonal in perspective; two identical sky blue houses at the near and far corners are tagged same house, the far one smaller, and a tower on the left carries x, y and z axes; a "from the side" inset bottom right shows the camera and the edges of its view volume over a side-on copy of the town; the pane's camera folder shows mode perspective, fov 60°, zoom 1.00 and distance 12.6](reference.png)

## API

- `view3d.camera`, a `Camera3D` that starts with its defaults: `mode` `'perspective'`, `fov` 60 and `zoom` 1. The pane
  binds `mode`, `fov` and `zoom` straight to it, and `frameTown()` sets `orthographicSize` (half the view's width) to
  fit the town and stands the camera back along its line until the town fits at the current `fov`.
- `camera.mode = 'orthographic'` switches the projection in place. The Isometric view button sets it and puts the
  camera on the (1, 1, 1) diagonal, a normalised `Vector3`, where x, y and z come out the same length on screen.
  `camera.useOrthographic(size)` would switch in one call but resets `near` and `far`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit round the town with `enableDamping`, no pan, `minDistance` and
  `maxDistance`, `minPolarAngle` and `maxPolarAngle`, and `minZoom` and `maxZoom`, which hold an orthographic camera's
  wheel zoom. `distance` is the read-only row, and its `'change'` event keeps the zoom row in step with the wheel.
- `stage.fog`'s `near` and `far`, moved with the camera each frame, since fog is measured from the camera.
- `Container3D`, `Mesh3D` and `Geometry3D`: the town's buildings, placed at `PointData3D` points, and the side view's
  copy of it, lit by its own `DirectionalLight` and `AmbientLight` and seen from a camera placed with `Spherical`.
- `View3D`: the main view. `Application` and `DEG_TO_RAD` from `pixi.js`.

## Controls

- Drag to orbit. The wheel zooms an orthographic camera and moves a perspective one closer.
- Pane, camera folder: `mode`, `fov` (disabled in orthographic, where it does nothing) and `zoom`; `distance` reads how
  far back the camera stands. Isometric view switches to orthographic on the isometric diagonal.

## Files

- `index.ts`: the lesson. The camera, the orbit, `frameTown()` and the pane.
- `scene.ts`: the clay town block, with the two identical houses at its nearest and farthest corners.
- `visuals.ts`: the same house tags, the axes on a tower, and the side view of the camera and its view volume.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` and its fog, `clayMaterial`, `clayGeometry`,
`roundedBox`, `roundedCylinder`, `InsetView`, `FrustumHelper`, `AxesHelper`, `ArrowHelper`, `LabelLayer`,
`ThemePane` and `LoadingScreen`.

## See also

- [Clipping planes](../cameras_clipping/README.md): the projection's `near` and `far`.
- [Orbit camera](../cameras_orbit/README.md): the `OrbitCamera` that moves this one, in full.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- cameras_projection` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
