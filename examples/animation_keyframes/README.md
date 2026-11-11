# Keyframes

Keyframe animation built in code: the PixiJS logo assembles itself from tracks an `AnimationPlayer` plays on the
logo's root. Each piece hops from a start through a bend to its place, the js badge rolls upright as it lands, and a
sky point light flashes on the landing. The frame draws a dot at every position keyframe, the path the interpolation
fills in between them, grey ghosts of the badge at its rotation keys, and the light's bulb. A keyframe is a value at a
time, a track holds one property's keyframes and names it `'<node>.<property>'`, and the interpolation decides what
happens between keys.

![The pink PixiJS logo mid-assembly over the light checker floor: the P, the ixi and both dots have landed, and the js badge is partway through its hop at the right, half rolled; ink dots mark each piece's start and bend keyframes, joined by straight lines, three grey ghosts of the badge show its rotation keys, upside down on the floor, on its side up high and upright in its place, and a grey bulb tagged flash hangs above the logo; the pane in the top right shows interpolation LINEAR, Play ticked, time 1.73 and intensity 0.0](reference.png)

## API

- `Vector3Track`, `QuaternionTrack` and `NumberTrack`, each with `label`, `times`, `values` and `interpolation`:
  `'<id>.position'` moves a piece, `'js.quaternion'` rolls the badge, and `'flash.intensity'` drives the light. All
  three are a `Track`; `values` holds each key's numbers in turn, 3 for a position, 4 for a quaternion, 1 for a number.
- `InterpolationMode`: `'STEP'` holds each key then jumps, `'LINEAR'` goes straight, and `'CUBICSPLINE'` follows a
  curve its tangents shape. `'CUBICSPLINE'` stores an in-tangent, the value and an out-tangent for every key, so
  `layout` rewrites the keys that way, and the example builds one `Animation` per mode from the same keyframes.
- `Animation` with `label`, `tracks` and `duration` (4 s, past the last key at 3.3 s, so the assembled logo holds
  before the loop).
- `AnimationPlayer` with `target`, `animations` and `autoUpdate: false`: it finds each track's node by label under
  `logo.root`, and the frame loop calls `player.update(ticker)`. `getState(label)`, then on the `AnimationState`
  `gotoAndStop(time)` and `play()`; switching mode stops the player first, since two states on the same labels would
  blend.
- `track.evaluate(time, 0, out)` and `track.valueSize`: the visuals sample the tracks the way the player does, so the
  drawn paths are exactly what plays.
- `PointLight` with `label: 'flash'`, under the logo's root, so its track finds it.
- `Quaternion` (`setFromEuler`, `toArray`, `fromArray`), `Vector3` and `PointData3D`: the roll's keys and the ghosts'
  poses.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping and no panning.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `interpolation` (STEP, LINEAR, CUBICSPLINE) plays the same keys another way from the same time; `Play` plays
  or stops; `time` scrubs; `intensity` reads the light's value as the `NumberTrack` writes it.

## Files

- `index.ts`: the lesson. The tracks, one `Animation` per interpolation, the player and the light.
- `keyframes.ts`: the keyframes as plain numbers, the badge's roll, and `layout`, the `'CUBICSPLINE'` value layout.
- `samples.ts`: reads the keys back and samples each track into the lines the visuals draw.
- `controls.ts`: the pane, which follows the playback.
- `visuals.ts`: the key dots, the paths, the tangent handles in `'CUBICSPLINE'`, the badge ghosts and the bulb.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `PathHelper`, `PointsHelper`,
`GhostHelper`, `LightHelper`, `LabelLayer`, `ThemePane`, `LoadingScreen` and `fitPortrait`, with `BRAND`, `THEMES`,
`themeFromUrl` and `NARROW_BELOW`.

## See also

- [Playing clips](../animation_clips/README.md): the same player on a glTF file's clips, blended by weight.
- [Tweening with GSAP](../animation_gsap/README.md): a similar entrance tweened by GSAP instead.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- animation_keyframes` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
