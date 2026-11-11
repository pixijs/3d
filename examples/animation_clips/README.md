# Playing clips

A glTF model's clips played with its `AnimationPlayer`: one at a time or blended, looped or once, at any speed, or
frozen at a time. The Khronos fox (`model('gltf.Fox')` from `examples/assets/manifest.ts`) trots side-on, half walk and
half run, with a see-through sky ghost on the left playing the walk alone and a purple one on the right playing the
run, each as solid as its clip's weight. The player keeps one `AnimationState` per clip, and two states playing at
once blend by their weights: that's both the walk-run mix and every crossfade between clips.

![The brown fox trotting side-on to the right in the middle of the light checker floor, a faint sky-blue ghost fox tagged Walk on the left and a faint purple one tagged Run on the right; the pane in the top right shows Clip Walk + Run, Blend 0.50, In step and loop ticked, Speed 1.00, a disabled gotoAndStop at 0.00, a Stop button, onLoop 0 and onComplete 0](reference.png)

## API

- `Model3D` with `autoUpdate: false`: a file with animations builds `model.player`, and the frame loop advances it
  with `player.update(ticker)`, which moves every playing state, blends their poses, then runs their callbacks.
- `AnimationPlayer`: `getState(label)` returns a clip's state, made on first ask and kept; `play(label)` starts one
  from its `time` while the others carry on; `stop()` stops them all; `playing` and `animationLabels` are read for
  the pane and the fade.
- `AnimationState`: `weight` (relative, so 0.5 and 0.5 mix like 1 and 1; eased over 0.3 s for each crossfade),
  `animationSpeed` (below 0 plays backwards), `loop`, `time`, `animation.duration`, `playing`, `play()`, `stop()`,
  `gotoAndPlay(time)` for a replay, and `gotoAndStop(time)`, which poses that clip alone, unblended. `onLoop` runs
  each time a looping state wraps, `onComplete` when a clip played once reaches its end.
- In step: a blended walk and run must take the same time per cycle, so `keepInStep` slows the walk's
  `animationSpeed` and speeds up the run's to a weighted cycle length.
- `Mesh3D`: the ghosts are two more `Model3D`s on the same `Scene3DSource`, each with its own player, whose skinned
  `Mesh3D` (found with `getChildByLabel('fox', true)`) gets a see-through material; they share the fox's geometry
  and textures.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping, no panning and a polar limit above the floor.
- `Application` and `Assets` (loads the `Scene3DSource`) from `pixi.js`.

## Controls

- Drag to orbit.
- Pane, in its `Playback` folder: `Clip` crossfades to Walk + Run, Survey, Walk or Run; `Blend` sets the walk-run
  mix and `In step` keeps their cycles matched (both only for Walk + Run); `Speed` from -2 to 2; `loop`;
  `gotoAndStop` stops and shows the picked clip at a time (off for the blend); the button stops, plays or replays;
  `onLoop` and `onComplete` count each callback since the clip was picked.

## Files

- `index.ts`: the lesson. The player, its states, the crossfade, keeping cycles in step, and every engine call the
  pane's rows make.
- `clips.ts`: the clip labels Fox.glb uses, the pane's clips, the ghosts' colours, and the `Mix` and `Calls` the pane
  reads.
- `controls.ts`: the pane's `Playback` folder, which follows what the player does.
- `visuals.ts`: the walk and run ghosts and their tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its spotlight, `ThemePane`, `LoadingScreen`,
`fitPortrait`, `createHelperMaterial` and `LabelLayer`, with `THEMES`, `CLAY` and `themeFromUrl`.

## See also

- [Keyframes](../animation_keyframes/README.md): the same player on clips built in code.
- [Driving bones](../animation_bones/README.md): turning a bone from code after the clip has posed it.
- [Crowd](../animation_crowd/README.md): one rig, many players, each at its own clip time.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- animation_clips` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
