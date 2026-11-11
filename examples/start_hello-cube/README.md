# Hello cube

The smallest @pixi/3d scene: an `Application`, a `View3D` on its stage, one `Mesh3D` made of a `CubeGeometry` and a
`Material3D`, and a `DirectionalLight`. A pink cube turns slowly in the middle of the screen, lit from the upper left,
and the view's `environment` lights the faces the light misses. Arrows show the light's direction, and a corner panel
shows the scene from the side with the camera the main view draws from; everything 3D goes under `view3d.root`.

![A pink cube on the pale haze, turned to show its top and two sides, with three arrows tagged light slanting down at it from the upper left; a corner panel titled from the side shows the cube at its left and the camera at its right, its view volume opening towards the cube; the pane in the top right shows baseColor 0xe91e63, Triangles off, intensity 3.00, environment on and Spin 0.50](reference.png)

## API

- `Mesh3D` with `CubeGeometry` and `Material3D`: the geometry is the shape and the material the surface. `rotation`
  turns the cube, and the pane binds `material.baseColor`.
- `DirectionalLight` with `intensity` and `position`: it shines along its own -z wherever it stands, so
  `light.lookAt(cube.position)` only sets its direction.
- `View3D` and its `root`: the 3D scene inside pixi's stage; `autoResize` keeps it the canvas's size. Its `camera`
  (`fov`, `position`, `lookAt`) frames the cube.
- `view3d.environment` set to a `Hemisphere` (`skyColor`, `groundColor`, `intensity`): light from all round, so a face
  turned from the light doesn't draw black. `null` turns it off, and switching between the two recompiles the
  materials. `view3d.fog = null` leaves the scene without fog.
- `Vector3`: the light's direction and the cube's reach, which the side view frames.
- `Application` from `pixi.js`: makes the canvas and runs the frame loop.

## Controls

- No pointer controls: the camera holds still.
- Pane: `baseColor` sets the cube's colour; `Triangles` shows its triangle edges; `intensity` sets the light's;
  `environment` turns the hemisphere off and on; `Spin` sets how fast the cube turns, in radians a second.

## Files

- `index.ts`: the lesson. The app, the view, the cube, the light, the environment and the pane.
- `visuals.ts`: the light's rays and tag, the cube's triangle edges, and the side view, a small view of its own with a
  copy of the cube and the main camera drawn as a glyph.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false` and its floor hidden, here
only for its backdrop and the pane's theme switch; `LightHelper`, `WireframeHelper`, `FrustumHelper`, `InsetView`,
`LabelLayer`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Model viewer](../start_model-viewer/README.md): a scene loaded from a glTF file instead of built in code.
- [WebGL and WebGPU](../start_renderers/README.md): the same scene code on either backend.
- [Light types](../lighting_light-types/README.md): the other lights a scene can use.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- start_hello-cube` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
