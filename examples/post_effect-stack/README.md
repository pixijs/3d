# Stacking effects

A view's post effects are one list, `view3d.passes`, and the frame runs through it in order: the scene draws into a
texture, each enabled effect reads the image the one before it wrote, and the last one draws to the screen. The PixiJS
logo goes through three effects in the order `[tiltShift, greyscale, tint]`: the floor blurs in front of and behind
the logo, greyscale takes the hue away, and the tint turns the grey to sepia. Order only matters among effects at one
stage that don't commute: tint before greyscale throws the tint away, while the blur runs at an earlier stage, so
moving it in the list changes nothing.

![The PixiJS logo in dark sepia over a sepia checker floor that blurs towards the camera and towards the horizon, the logo sharp with a faint light fringe at its edge; the pane in the top right shows view3d.passes set to [tiltShift, greyscale, tint], every effect's enabled ticked, and the tint at 0xf7ca9c](reference.png)

## API

- `View3D` `passes`: the ordered effect list. The view copies the array it's given, so only a new array reorders it.
  A new array, or a flip of an effect's `enabled`, rebuilds the render graph once: fine for a toggle, not every frame.
  With every effect off, the view draws straight to the screen.
- `PostEffect` `enabled`: `false` skips an effect but keeps its place in the list.
- `TiltShiftEffect` from `@pixi/3d/extras`: a blur by depth. `focalNear: 1` and `focalFar: 4` keep a sharp band 1 unit
  either side of the focal plane, so the swaying logo stays in focus, and `focalDepth` follows `orbit.distance` every
  frame, a uniform write.
- `TintEffect` from `@pixi/3d/extras`: every pixel times `tint`, here a pale orange. The getter reads back a hex
  number and the setter takes any colour, so the pane binds it straight.
- `GreyscaleEffect`: the example's own `PostEffect`. Its `fragment`, an `EffectFragment` with a WGSL and a GLSL body,
  defines `effect(uv)`, which reads `sampleColor(uv)` and writes its luma into all three channels; it has no uniforms.
  Its constructor passes `PostEffectOptions` on with `stage: 'afterToneMapping'`, `TintEffect`'s stage, since effects
  run stage by stage and only effects at the same stage run in array order.
- `View3D`: the 3D scene inside pixi's stage, and its `camera` with `fov` 40, level with the logo.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, without pan, between 6 and 16 units and never under the floor.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit, scroll to zoom; the focal plane follows the zoom.
- Pane: the `view3d.passes` folder picks one of three orders, `[tiltShift, greyscale, tint]` (sepia),
  `[tiltShift, tint, greyscale]` (grey) and `[greyscale, tint, tiltShift]` (sepia again). The `tiltShift`,
  `greyscale` and `tint` folders each switch their effect with `enabled`, and `tint` sets the tint's colour.

## Files

- `index.ts`: the lesson. The three effects, the orders the pane offers, and the focal plane that follows the orbit.
- `GreyscaleEffect.ts`: the greyscale effect, its shader in one WGSL and one GLSL string.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its `spotlight`, `loadPixiLogo`,
`ThemePane`, `LoadingScreen`, `fitPortrait`, and `mixColor` with `BRAND` for the sepia.

## See also

- [Custom effect](../post_custom-effect/README.md): a `PostEffect` with uniforms of its own, and one of several passes
  through `build()`.
- [Tilt shift](../post_tilt-shift/README.md): the depth blur on its own, with its focus settings.
- [Render graph](../post_render-graph/README.md): the graph the list of passes builds.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_effect-stack` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
