# Depth of field

A camera lens's depth of field: one depth in front of the camera stays sharp, and what's nearer or farther blurs.
Three clay shapes stand at three depths, and tapping one brings it into focus. The sharp zone is a plane facing the
camera, so a band of the floor at the shape's depth stays sharp with it. The sharp shape keeps a clean edge against the
blur behind it, and a blurred shape in front spreads over the sharp floor. The pane picks how many taps the blur takes
and paints the focus zones.

![The light checker floor with three clay shapes at three depths, a pink cube near on the left, a sky-blue torus in the middle and an orange crystal far on the right: the torus and a band of floor at its depth are sharp, while the cube, the crystal and the rest of the floor blur, the cube's soft edge spreading over the sharp band; the pane in the top right shows Focus on Middle torus, Manual distance 13.0, and the DepthOfFieldEffect folder with quality auto, focusDistance 13.3, focusRange 0.65, focusFalloff 0.65, maxBlur 16 and debug off](reference.png)

## API

- `DepthOfFieldEffect` from `@pixi/3d/extras`: blurs the scene by each pixel's depth in front of the camera. Within
  `focusRange` (0.65) of `focusDistance` a pixel stays sharp, and its blur grows over `focusFalloff` (0.65) to
  `maxBlur` physical pixels. `maxBlur` is 16 CSS pixels times `app.renderer.resolution`, so it looks the same on a 2×
  screen. Every setting but `quality` is a uniform write, so the focus follows the picked shape every frame for free.
- `DepthOfFieldEffect` `quality`: `'high'` takes 48 taps a pixel, `'low'` 16 at half the screen's resolution, and the
  default `'auto'` takes `'low'` on a phone. It's fixed at construction, so the pane's row builds a new effect with the same settings (`DepthOfFieldEffectOptions`)
  and replaces `view3d.passes`, which rebuilds the render graph once. Raise `maxBlur` to see where `'low'` turns grainy.
- `DepthOfFieldEffect` `debug`: paints the zones over a grey copy of the frame, a white line at the depth in focus,
  green in the sharp zone, orange in front of it and blue behind.
- `View3D` with `passes: [depthOfField]`: the effect runs at the default `'beforeToneMapping'` stage, on the scene's
  linear light.
- `Vector3`, `getGlobalPosition()` and `camera.toLocal()`: each frame the picked shape's position goes into camera
  space, and its `-z` becomes `focusDistance`. A depth, not a straight-line distance, so orbiting keeps it in focus.
- `Mesh3D` with `eventMode = 'static'`, `cursor = 'pointer'` and a `pointertap` listener: tapping a shape focuses on
  it.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`.

## Controls

- Tap a shape to focus on it; drag to orbit.
- Pane: `Focus on` picks Near cube, Middle torus, Far crystal or Manual distance; `Manual distance` sets the plane by
  hand and switches to it. The `DepthOfFieldEffect` folder has `quality`, `focusDistance` (read-only, it follows the
  focus), `focusRange`, `focusFalloff`, `maxBlur` and `debug`.

## Files

- `index.ts`: the lesson. The three shapes, the effect, tap to focus, the pane and its quality swap, and the plane
  following the picked shape.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry` and `clayMaterial`, `THEMES` and
`themeFromUrl`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Tilt shift](../post_tilt-shift/README.md): the same effect on a clay town, with a long falloff, so it reads as a
  miniature.
- [Custom effect](../post_custom-effect/README.md): a post effect of your own, one fragment or its own `build()`.
- [Motion blur](../post_motion-blur/README.md): `MotionBlurEffect`, a blur by the camera's motion rather than by depth.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_depth-of-field` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
