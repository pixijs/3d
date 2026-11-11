# Crowd

A herd of animated characters from one file, each with its own pose, player and place in its clip. Twelve Khronos foxes
(`model('gltf.Fox')` from `examples/assets/manifest.ts`) stand, walk and run in a loose wedge, every one a `Model3D`
built from the same `Scene3DSource`, with the front fox's rig drawn in pink and the rest in pale ink. The models share
the source's geometry, material and texture, so the whole herd is one draw call, plus one in the shadow pass, however
many foxes it holds; what each one owns is its skeleton's pose and a player with its own clip time and speed.

![Twelve orange foxes in a loose wedge on the light checker floor, all side-on to the right, each with pale bones drawn through its fur, and the one at the front with pink bones and a front fox tag under it; the pane in the top right shows Foxes 12, Draws 1, Shadow draws 1, Start times scattered, baseColor 0xffffff, then a Front fox folder with Clip Walk and animationSpeed 1.00, and Bones every fox](reference.png)

## API

- `Model3D` from one `Scene3DSource`, with `autoUpdate: false`, `scale`, `position` and `rotation`: `Assets` loads
  the file once and every fox is built from it. One loop on the app's ticker calls `fox.player.update(ticker)` for
  each, so the whole crowd runs on the app's clock.
- `Skeleton`, from `fox.skeletons[0]`: shares the source's `parent`, `joints` and inverse bind matrices, and holds a
  pose of its own. `indexOf('b_Hip_01')` roots the drawn rigs at the hip.
- `AnimationPlayer` and `AnimationState`: `player.play(label)` returns the clip's state, whose `time` scatters each
  fox through its clip (a golden ratio step) or sets them all at 0, and whose `animationSpeed` the pane sets on the
  front fox. `player.stop()` then `play()` switches the front fox's clip, and each state keeps its own place.
- `model.destroy({ children: true })` removes a fox when the crowd shrinks; it frees the model's player and skeleton,
  and the source the others draw with stays.
- `Material3D`: the source's `fox_material` is one material for every fox, so one write reaches the herd:
  `roughness` 1 at load, since Fox.glb has no normals, and the pane's `baseColor`, which multiplies the fur texture.
- `RenderGraphDebugger` from `@pixi/3d/extras`: `capture()` reads the frame drawn last, and the pane counts the draws
  whose `geometryIds` include the fox's geometry (`source.geometries[0][0].uid`), split by the `shadow` pass.
- `PointData3D`: each fox's slot in `crowdSlot`.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping, no panning and a polar limit above the floor.
- `Application` and `Assets` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane, in `Every fox`: `Foxes` sets the crowd's size, `Draws` and `Shadow draws` read the herd's draw calls,
  `Start times` scatters the clip times or puts them all at 0, and `baseColor` tints the shared fur.
- In `Front fox`: `Clip` (Survey, Walk, Run) and `animationSpeed` from -2 to 2.
- `Bones`: draw every fox's skeleton, the front fox's only, or none.

## Files

- `index.ts`: the lesson. One source, a `Model3D` per fox with its own player and start time, one update loop, and
  growing and shrinking the herd.
- `scene.ts`: `crowdSlot`, where each fox stands and faces by its index, and `MAX_FOXES`.
- `controls.ts`: the pane, and the draw counts read from a `RenderGraphDebugger` capture after each size change.
- `visuals.ts`: a skeleton on every fox, loud on the front one, and the `front fox` tag.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its fog pushed back, `ThemePane`,
`LoadingScreen`, `fitPortrait`, `SkeletonHelper` and `LabelLayer`, with `THEMES`, `themeFromUrl` and `NARROW_BELOW`.

## See also

- [Playing clips](../animation_clips/README.md): one player's states, blended and crossfaded.
- [Driving bones](../animation_bones/README.md): writing one bone of a skeleton from code.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- animation_crowd` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
