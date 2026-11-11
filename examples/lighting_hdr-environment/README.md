# HDR environment

Why a sky loaded from a Radiance `.hdr` file keeps the sun brighter than white, and a JPG one doesn't. The same
Venice sunset lights each half of a split screen: the left half from the `.hdr` panorama, the right from a `.cubemap`
of six JPGs. Each half holds the PixiJS logo in pale near-mirror metal and a chrome ball, facing the sun with the
camera in front, so the metal mirrors the sun at the reader. Both halves open two stops down, at a quarter of the
light. The `.hdr` sun, thousands of times brighter than white, still burns as a hot glint on the logo, ringed by
bloom. The JPG sun was stored as white at most, so a quarter of it is a dull grey smudge.

![A split screen of the same dusky Venice street in each half, a pale pink metal PixiJS logo over a chrome ball; on the left, captioned .hdr, a white-hot glint with an orange glow burns on the logo's x and the ball mirrors the sun as a small orange-white hot spot on its horizon, and on the right, captioned .cubemap, the logo is a dull mauve with only a faint warm smudge where the glint was and the ball shows a broad grey band; the pane in the top right shows Exposure (stops) -2.0 and a BloomEffect folder with enabled on and threshold 2.0](reference.png)

## API

- `Assets.load` from `pixi.js` with an `.hdr` URL: the `loadHdr` parser, which `@pixi/3d` registers on import, turns
  the equirectangular panorama into a float `CubeTexture` that keeps the sun at its real brightness. The conversion
  runs on the main thread while the file loads, about 50 ms for this 1k panorama, and loading
  `{ src, data: { faceSize } }` trades memory for a sharper sky. With a `.cubemap` URL it loads six JPGs, which stop
  at white.
- `View3D` `environment` and `background`: each half takes its own cube for both, so the sky behind the logo is the
  light on it. A float cube is read as linear light, so the `.hdr` sun stays past white in every reflection.
- `View3D` `exposure`: scales all the light before the tone curve. The pane writes `2 ** stops` to both views, so the
  source is the only difference between them.
- `View3D` `toneMapping` `'aces'` on both views: it rolls the `.hdr` sun off towards white instead of clipping it
  flat.
- `BloomEffect` from `@pixi/3d/extras`, one in each view's `passes`, with `threshold` 2 and `intensity` 0.4. It
  glows only from light twice as bright as white, which only the `.hdr` sky holds at 0 stops or under. `enabled` and
  `threshold` change at runtime; the `.cubemap` view's effect copies the `.hdr` view's.
- `Material3D` with `metallic` 1: the logo's pale pink metal at `roughness` 0.08, and the ball's chrome at 0.15,
  rough enough to spread the `.hdr` sun into a hot spot. A metal shows only what it reflects, so its glint is the sun
  itself. One material draws in both views, each under its own view's environment.
- Two `View3D`s side by side, since an environment belongs to a whole view: the first spans the screen and draws into
  its camera's `viewport`, and the second copies its camera each tick. A mesh belongs to one view, so each builds its
  own logo and `Mesh3D` ball, a `SphereGeometry`, under its `root`, a `Container3D`.
- `OrbitCamera` from `@pixi/3d/extras`: drag either half to orbit, all the way round. On a portrait screen its
  `target` rises, so both halves' subjects sit lower and clear of the open pane.
- `Application`, `Rectangle` and `Point` from `pixi.js`: `Rectangle` holds each half's rect on screen, and `Point` a
  caption's corner.

## Controls

- Drag either half to orbit; both move as one. A little past half way round, the sun itself sits in the sky beside
  the logo: a white-hot disc over its glittering reflection in the `.hdr` half, a pale yellow one in the `.cubemap`
  half.
- Pane: `Exposure (stops)` sets both views' `exposure`, from -4 to 2 stops. The `BloomEffect` folder sets both
  effects' `enabled` and `threshold`; it opens closed on a phone or a portrait screen, so the open pane stays above
  the logos. Turn the exposure up to 2 stops to see what the threshold does: at 2 the `.cubemap` half, now four
  times brighter, glows too, a haze round its pale logo, and at 8 only the `.hdr` sun does.

## Files

- `index.ts`: the lesson. The two views, the two skies, the shared exposure and tone curve, the bloom and the pane.
- `scene.ts`: what each half builds for itself, the metal logo and the chrome ball facing the sun, and the logo's
  sway, which slides the glint between the first i and the x and never off the logo.
- `split.ts`: the split screen, side by side or stacked on a portrait screen, with one orbit for both halves.
- `visuals.ts`: each half's source named in its corner.

From the theme kit (`examples/shared/theme/README.md`): a `ThemeStage` per view with `lights: false`, its floor
hidden and its fog off, since the sky is the only light; `loadPixiLogo`, `ScreenLines` for the divider,
`LabelLayer`, `ThemePane`, `LoadingScreen`, `fitPortrait`, and `BRAND`, `mixColor`, `THEMES` and `themeFromUrl` from
the palette. The `.hdr` comes from `environment('hdri.VeniceSunset')` in `examples/assets/manifest.ts`.

## See also

- [Environment light](../lighting_environment/README.md): where image-based light comes from, and the background
  drawn apart from it.
- [Tone mapping](../lighting_tone-mapping/README.md): the curves that bring light past white into a screen's range.
- [Bloom](../post_bloom/README.md): light past white glowing out past its edges, and every setting of the effect.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- lighting_hdr-environment` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
