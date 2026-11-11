# Custom effect

Post effects of your own, written the two ways a `PostEffect` allows. `VignetteEffect` declares one fragment and its
uniforms, and the base class builds the single fullscreen pass that runs them. `EdgeBlurEffect` overrides `build()`
and adds three passes to the render graph itself: two blurs into small textures, then a mix toward the edges. The
picture is the theme stage through both, sharp in the middle and blurred and darkened toward the sides.

![The pink PixiJS logo over the light checker floor with the seven clay shapes in an arc in front, the middle shapes sharp and the cube and torus at the ends blurred, and the frame darkened toward its corners; the pane in the top right shows vignette on with strength 0.55, radius 0.25 and softness 0.35, and edgeBlur on with radius 0.20, softness 0.25, size 12 and resolution 0.25](reference.png)

## API

- `PostEffect`: the engine class both effects extend, with `PostEffectOptions` (here `enabled`) as the base of their
  options. `VignetteEffect.ts` holds the vignette's shader: `fragment` is an `EffectFragment`, a WGSL `gpu` and a GLSL
  `gl` string that each define `effect(uv)` and read the frame with `sampleColor(uv)`, and `uniforms` is a
  `UniformGroup` with one `uVignette` vec4. The base class's `build()` wraps them in one fullscreen pass.
- `PostEffectOptions` `stage`: an effect runs at `'beforeToneMapping'`, on linear light, unless it says otherwise. The
  edge blur stays there; the vignette passes `'afterToneMapping'` to `super`, so it darkens the picture as it shows.
- `PostEffect` `writeLane()`: every property setter on both effects writes one lane of a vector uniform and marks its
  group dirty, so a change is a uniform write, free every frame.
- `EdgeBlurEffect.ts` holds the blur and mix shaders and overrides `build(graph, io)`. `graph.createColor()` makes
  two textures at the effect's `resolution`, and three `FullscreenPass` objects (`blurAcross`, `blurDown`, `edgeMix`)
  each take a `fragment`, `uniforms`, `reads` and `writes`. The blurs share one shader with a `uBlur` group each; the
  mix reads `color` and `color2`, sampling the second with `sampleColor2`.
- `EffectIO` and `RenderGraph`: `build()` gets the graph and `io`, with `renderer`, `input` (the frame so far) and
  `output`, where the result must land; `null` when the effect is last and draws to the screen.
- `View3D` `passes`: `[edgeBlur, vignette]` run in array order, each reading what the one before wrote, and the last
  enabled one draws to the screen. With any effect on, the scene draws into a texture first, multisampled when the
  canvas has `antialias`. Flipping `enabled` rebuilds the graph; a new `resolution` takes a new `EdgeBlurEffect`, and
  the example calls `destroy()` on the old one, since the view never destroys a pass it drops.
- `Mesh3D` and `Container3D`: the seven clay shapes, bobbing and turning under `view3d.root`.
- `OrbitCamera` from `@pixi/3d/extras`, and `Application` and `UniformGroup` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: the `vignette` folder has `enabled`, `strength`, `radius` and `softness`; the `edgeBlur` folder has `enabled`,
  `radius`, `softness`, `size` and `resolution` (1, 0.5, 0.25 or 0.125, which replaces the effect).

## Files

- `index.ts`: the lesson. The two effects in `view3d.passes`, and swapping the edge blur for a new `resolution`.
- `VignetteEffect.ts`: the single-pass effect, its shader and its uniform properties.
- `EdgeBlurEffect.ts`: the multi-pass effect, its two shaders and its `build()`.
- `controls.ts`: the pane's two folders.
- `scene.ts`: the arc of clay shapes in front of the logo.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its spotlight, `loadPixiLogo`,
`clayGeometry` and `clayMaterial` over `CLAY_SHAPES` and `CLAY_COLORS`, `THEMES` and `themeFromUrl`, `ThemePane`,
`LoadingScreen` and `fitPortrait`.

## See also

- [Stacking effects](../post_effect-stack/README.md): the built-in effects in one `passes` array, and their order.
- [Depth of field](../post_depth-of-field/README.md): a single-fragment effect that reads depth and a mipmapped input.
- [Custom tone mapping](../post_custom-tone-mapping/README.md): an effect that runs in a render graph of your own.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_custom-effect` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
