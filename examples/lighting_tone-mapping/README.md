# Tone mapping

How a view turns the light in its scene into colours a screen can show. A screen shows each channel from 0 to 1, but
a strong spot on the logo's `JS` and a row of hot pink balls glowing at strengths 0.5 to 8 land far past 1. The left
half is a view with `toneMapping` `'none'`, where light past 1 clips: bright parts go flat and the balls change hue as
their red runs out first. The right half uses the curve the pane picks, `'aces'` to start, which bends instead, so
bright colour fades towards white; it tone maps the floor and sky too, which turn greyer.

![A split screen with the hot pink PixiJS logo and a row of five glowing pink balls numbered 0.5, 1, 2, 4 and 8 in each half; on the left, captioned none, the spotlit JS goes flat magenta, the balls past 1 go flat and the 4 turns violet, and on the right, captioned aces, the JS and the balls fade towards white over a greyer floor and sky; the pane in the top right shows toneMapping aces and exposure 1.00](reference.png)

## API

- `View3D` `toneMapping`, a `ToneMapping`: the curve from light to screen colour, one setting for the whole view,
  background and fog included. `'none'` (the engine's default) only encodes for the screen; `'aces'`, `'reinhard'` and
  `'uncharted2'` are filmic curves; `'custom'` leaves the light linear for a post pass of your own. A new curve
  recompiles the view's materials.
- `View3D` `exposure`: scales all the light before the curve, free to change every frame. Both views share it, so the
  curve is the only difference between the halves.
- `Material3D` `emissive` group with `color` and `strength`: the balls' glow, at strengths that double from 0.5 to 8
  on a near-black body. One set of materials draws in both views, each through its own view's curve.
- `SpotLight` with `intensity` 600, `coneAngle`, `penumbra` and `range`: the light past 1 on each logo's `JS`, with
  no shadow and a `range` that ends the beam before the floor behind.
- Two `View3D`s side by side, since a curve belongs to a whole view: the first spans the screen and draws into its
  camera's `viewport`, and the second, with `eventMode = 'none'`, copies its camera each tick. A mesh belongs to one
  view, so each builds its own `Mesh3D`s and logo under its `root`, a `Container3D`.
- `OrbitCamera` from `@pixi/3d/extras`: drag either half to orbit, inside limits that keep the subject in view.
- `Application`, `Rectangle` and `Point` from `pixi.js`: `Rectangle` holds each half's rect on screen, and `Point` a
  caption's corner.

## Controls

- Drag either half to orbit; both move as one.
- Pane: `toneMapping` picks the right view's curve; `exposure` sets both views' exposure, from 0.25 to 4.

## Files

- `index.ts`: the lesson. The two views, their curves, the glow materials and the shared exposure.
- `scene.ts`: what each half builds for itself, the spotlit logo and the row of glowing balls.
- `split.ts`: the split screen, side by side or stacked on a portrait screen, with one orbit for both halves.
- `visuals.ts`: each half's curve named in its corner, and each ball's strength under it.

From the theme kit (`examples/shared/theme/README.md`): a `ThemeStage` per view, whose `'none'` curve the right view
replaces; `createClayMaterial` with `emissive`, `loadPixiLogo`, `clayGeometry`, `ScreenLines` for the divider,
`LabelLayer`, `ThemePane`, `LoadingScreen`, `fitPortrait`, and `BRAND`, `THEMES` and `themeFromUrl` from the palette.

## See also

- [Custom tone mapping](../post_custom-tone-mapping/README.md): the `'custom'` curve, with the tone map and encode in
  your own effect.
- [Bloom](../post_bloom/README.md): bright light past 1 glowing out past its edges.
- [Environment light](../lighting_environment/README.md): where the light that `exposure` scales comes from, and
  the background drawn apart from it.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- lighting_tone-mapping` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
