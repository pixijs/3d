# Morph targets from glTF

A glTF file's morph targets, played by its clip and set by hand. The big pink cube is Khronos's AnimatedMorphCube,
loaded from the asset mirror with `model('gltf.AnimatedMorphCube')`, and plays the file's `Square` clip, which blends
its two targets in and out over 4.2 s; it opens 2.2 s in, on a mix of both, leaning into a wedge. In front of it, three
small copies of the same source hold the base shape, target 0 (the cube thinned along its depth) and target 1 (a wedge).
The morphed mesh keeps one weight per target in its `weights` array: the clip writes it while it plays, and once stopped
the array is yours to write.

![A big pink cube floating over the light checker floor, morphed into a leaning wedge by a mix of both targets, above a row of three small pale pink copies on the floor, tagged base, target 0 for a thin slab and target 1 for a wedge; the pane in the top right shows Play clip ticked, weights[0] 0.32 and weights[1] 0.68](reference.png)

## API

- `Model3D` with `autoUpdate: false`: the frame loop calls `player.update(ticker)`, so the weights the clip writes are
  in place before the pane's rows read them and the frame draws.
- `Mesh3D` `weights`: a `Float32Array` with one weight per morph target, found on the node the file names
  `AnimatedMorphCube` with `getChildByLabel(label, true)`. Only a mesh whose geometry has morph targets has one.
  Write into it (`weights.set(pose)`, `weights[i] = value`), never replace it: a clip bound to it would keep writing
  the old one.
- The clip's one track, `'0.weights'`, names node 0 and its `weights`; `player.getState('Square')` gives its
  `AnimationState`, which opens with `gotoAndStop(2.2)` then `play()`, and the pane calls `play()` and `stop()`.
  A weight set by hand stops the clip first, since a playing clip writes every weight on each update.
- Several `Model3D`s from one `Scene3DSource`: they share the geometry, morph targets included, and each holds its
  own weights, so the copies stay at their poses while the big cube plays.
- `mesh.material`: each cube is re-skinned from the file's flat grey to the kit's clay.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping, no panning and a polar limit above the floor.
- `Application` and `Assets` (loads the `Scene3DSource`) from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `Play clip` plays or stops the clip; `weights[0]` and `weights[1]` follow the clip while it plays, and setting
  one by hand stops it.

## Files

- `index.ts`: the lesson. Loads the cube, finds its morphed mesh, plays the clip, the copies at each pose, and a pane
  row bound to each weight.
- `visuals.ts`: the `base`, `target 0` and `target 1` tags under the copies.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayMaterial`, `ThemePane`, `LoadingScreen`,
`LabelLayer` and `fitPortrait`, with `THEMES` and `themeFromUrl`.

## See also

- [Morph targets](../geometry_morph-targets/README.md): morph targets built in code on a `Geometry3D`.
- [Playing clips](../animation_clips/README.md): the player and its states on a skinned model's clips.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- animation_morph-targets` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
