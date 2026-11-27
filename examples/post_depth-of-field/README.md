# Depth of field

A camera lens's depth of field: one depth in front of the camera stays sharp, and what's nearer or farther blurs.
Three clay shapes stand at three depths, and tapping one brings it into focus. The sharp zone is a plane facing the
camera, so a band of the floor at the shape's depth stays sharp with it. The sharp shape keeps a clean edge against the
blur behind it, and a blurred shape in front spreads over the sharp floor. `Compare TiltShiftEffect` swaps in the tilt
shift with the same settings, which blurs from mipmaps and leaves a faint halo round the sharp shape and a hard edge
where the blurred cube crosses the sharp band.

![The light checker floor with three clay shapes at three depths, a pink cube near on the left, a sky-blue torus in the middle and an orange crystal far on the right: the torus and a band of floor at its depth are sharp, while the cube, the crystal and the rest of the floor blur, the cube's soft edge spreading over the sharp band; the pane in the top right shows Focus on Middle torus, Manual distance 13.0, the DepthOfFieldEffect folder with focusDistance 13.3, focusRange 0.65 and maxBlur 16, and Compare TiltShiftEffect off](reference.png)

## API

- `DepthOfFieldEffect` from `@pixi/3d/extras`: blurs the scene by each pixel's depth in front of the camera. Within
  `focusRange` (0.65) of `focusDistance` a pixel stays sharp, and its blur grows to `maxBlur` physical pixels at twice
  `focusRange`. `maxBlur` is 16 CSS pixels times `app.renderer.resolution`, so it looks the same on a 2× screen. Every
  setting is a uniform write, so the focus follows the picked shape every frame for free.
- `TiltShiftEffect` from `@pixi/3d/extras`: the comparison. Its `focalDepth`, `focalNear`, `focalFar` and `maxBlur`
  are copied from the depth of field each frame, so both effects mark out the same zones.
- `View3D` with `passes: [depthOfField, tiltShift]`: both effects run at the default `'beforeToneMapping'` stage, on
  the scene's linear light. The tilt shift starts with `enabled: false`; the pane's switch flips `enabled` on both,
  which rebuilds the render graph once.
- `Vector3`, `getGlobalPosition()` and `camera.toLocal()`: each frame the picked shape's position goes into camera
  space, and its `-z` becomes `focusDistance`. A depth, not a straight-line distance, so orbiting keeps it in focus.
- `Mesh3D` with `eventMode = 'static'`, `cursor = 'pointer'` and a `pointertap` listener: tapping a shape focuses on
  it.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`.

## Controls

- Tap a shape to focus on it; drag to orbit.
- Pane: `Focus on` picks Near cube, Middle torus, Far crystal or Manual distance; `Manual distance` sets the plane by
  hand and switches to it. The `DepthOfFieldEffect` folder has `focusDistance` (read-only, it follows the focus),
  `focusRange` and `maxBlur`. `Compare TiltShiftEffect` swaps the tilt shift in with the same settings.

## Files

- `index.ts`: the lesson. The three shapes, the two effects, tap to focus, the pane, and the plane following the
  picked shape.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry` and `clayMaterial`, `THEMES` and
`themeFromUrl`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Tilt shift](../post_tilt-shift/README.md): `TiltShiftEffect` on a clay town, where its blur reads as a miniature.
- [Custom effect](../post_custom-effect/README.md): a post effect of your own, one fragment or its own `build()`.
- [Motion blur](../post_motion-blur/README.md): `MotionBlurEffect`, a blur by the camera's motion rather than by depth.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_depth-of-field` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
