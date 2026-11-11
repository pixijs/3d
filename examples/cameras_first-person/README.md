# First-person camera

`FPSCamera` drives the view's camera from a position, a `yaw` and a `pitch`: the mouse looks, WASD walks where the
camera faces, and `move` takes any other input, here an on-screen stick for touch. The picture stands outside the
entrance of a clay maze, looking in at the logo floating over its centre room. The example steps the camera from its
own ticker so the walls can push back before the frame draws, and a plan in the corner shows the camera from above,
since nobody can see the camera they look through.

![A lilac and purple clay maze from just outside its entrance, the pink PixiJS logo floating over the centre; a "from above" inset on the right shows the maze in outline with the camera as a small frustum below the entrance, an on-screen stick sits bottom right, and the pane shows moveSpeed 5.0, lookSpeed 0.0020, pointerLock ticked, yaw 0.00 and pitch -0.12](reference.png)

## API

- `FPSCamera` from `@pixi/3d/extras`, built with `view`, a start `position`, `yaw` (0 faces -z, positive turns left),
  `pitch` clamped to `±maxPitch`, `pointerLock` (a click locks the mouse to look, Esc releases it), `moveSpeed` and
  `lookSpeed`. `autoUpdate: false` hands stepping to the example: `update(ticker)` walks by this frame's keys and
  `move`, and returns `true` when the camera moved, so the maze's `collide` runs only then.
- `FPSCamera` `move`: a `Vector3` of walking input added to the keys each update; the stick's push goes into its `x`
  and `z`. `keyboard` turns the `window` key listeners off while a pane text field has focus, and the `lock` and
  `unlock` events fold the pane away while the mouse is locked. `camera` is the `Camera3D` it drives, whose `fov`
  widens on a narrow screen.
- `Mesh3D`, `Container3D` and `BaseMaterial3D`: the maze's walls, one mesh per post and panel on two shared
  geometries, and the flattened copy the plan draws. `PointData3D` types the start pose; `collide` pushes the camera's
  `position`, a `Vector3`, out of the walls and holds it at eye height.
- `PlaneGeometry`: the sheet under the plan. `View3D`: the 3D scene inside pixi's stage.
- `Application`, `DEG_TO_RAD`, `RAD_TO_DEG` and `Rectangle` from `pixi.js`; the stick is plain pixi, a `Container`
  with a `Circle` hit area, `Graphics` parts, and a `Point` it fills from each `FederatedPointerEvent`.

## Controls

- Click the view to lock the mouse and look around; Esc releases it. Drag to look on touch, or with `pointerLock`
  unticked.
- WASD or the arrow keys walk; on touch, the stick bottom right walks, and a second finger drags to look.
- Pane: `moveSpeed`, `lookSpeed` and `pointerLock` (hidden on a touch screen); `yaw` and `pitch` are read-only rows
  that follow the camera.

## Files

- `index.ts`: the lesson. The `FPSCamera`, the pane, and the ticker that feeds the stick into `move` and steps it.
- `scene.ts`: the clay maze, built from a map of strings, with its start pose and `collide`.
- `joystick.ts`: the on-screen stick, whose `value` reads the push.
- `visuals.ts`: the plan inset, a flat copy of the maze with the camera's view volume drawn into it.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its spotlight, `loadPixiLogo`,
`clayMaterial`, `roundedBox`, `InsetView`, `FrustumHelper`, `helperMaterial`, `createHelperMaterial`, the overlay
colours, `ThemePane` and `LoadingScreen`.

## See also

- [Orbit camera](../cameras_orbit/README.md): the other camera controller, turning round a target.
- [Clipping planes](../cameras_clipping/README.md): the camera's `near` and `far`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- cameras_first-person` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
