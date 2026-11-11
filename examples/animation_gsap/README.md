# Tweening with GSAP

GSAP tweens a node's position, rotation and scale, and a material's colour. The PixiJS logo assembles itself once as
the page opens: the P and the ixi drop in with a bounce, the dots grow from nothing, the js badge spins upright, and the
paint fades from sky to the logo's pink, while ink ghosts of the assembled pieces mark where every tween ends. A
`Container3D`'s `position`, `rotation` and `scale` are plain objects with `x`, `y` and `z`, so GSAP animates them with
no plugin, and `from()` on a timeline plays each piece in from wherever it's told to where it already sits.

![The PixiJS logo early in its entrance over the light checker floor, painted sky: the P drops towards its place, the ixi still hangs raised above its own, the dots haven't grown yet and the js badge sits upside down, while grey ghosts of the assembled logo mark where each piece ends, with an end pose tag left of the P; the pane in the top right shows ease bounce.out, timeScale 1.00 and a Replay button](reference.png)

## API

- `gsap.timeline({ defaults: { duration, ease } })` and `from(target, vars, position)` from `gsap`: the timeline
  tweens `p.position` and `ixi.position` (`y: '+=2.4'`), both dots' `scale` from 0, and `js.rotation` from
  `z: -Math.PI`, each starting a beat after the one before (`'<0.3'`, `'<0.6'`, `'<0.4'`). `revert()` puts every piece
  back where `from()` found it before a new timeline is built; `restart()`, `progress()` and `timeScale()` drive the
  pane.
- `gsap.ticker.remove(gsap.updateRoot)`, then `gsap.updateRoot(seconds)` from the app's ticker: every tween moves once
  a frame, just before the frame draws, and holds still until the app starts.
- A colour through a stand-in: GSAP blends a CSS colour string channel by channel, so it tweens `paint.color`, and
  each frame writes the string to the shared material's `baseColor`. Tweening the hex number would run through
  unrelated colours.
- `Container3D`: each logo piece hangs on a pivot at its own centre (`logo.pieces.p.pivot`), so position, rotation and
  scale act about its middle; the ghosts sit in a `Container3D` of their own.
- `Box.fromCenterSize(center, size)`, set on `stage.key.shadow.bounds`: one shadow box over the pieces' whole path, so
  the shadows hold still while the pieces fall rather than refit every frame. It takes in the floor the shadows fall
  on too, so they reach it whole.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping, no panning and a polar limit above the floor.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `ease` replays the entrance with `bounce.out`, `back.out(1.7)`, `elastic.out(1, 0.4)`, `power3.out` or
  `none`; `timeScale` from 0.1 to 2 changes the pace mid-flight, or replays a finished entrance at the new pace;
  `Replay` plays it from the start.

## Files

- `index.ts`: the lesson. GSAP on the app's ticker, the timeline of `from()` tweens, the colour stand-in, and the pane.
- `visuals.ts`: the ghosts of the assembled logo and their `end pose` tag, shown while the entrance plays.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo` with `LOGO_PIECES`, one
`EnamelMaterial` for every piece, `GhostHelper`, `LabelLayer`, `ThemePane`, `LoadingScreen` and `fitPortrait`, with
`BRAND`, `cssColor`, `THEMES`, `themeFromUrl`, `NARROW_BELOW` and the `PixiLogo` type.

## See also

- [Keyframes](../animation_keyframes/README.md): the same kind of entrance as the engine's own clips.
- [Transforms](../scene_transforms/README.md): the `position`, `rotation` and `scale` the tweens write.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- animation_gsap` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
