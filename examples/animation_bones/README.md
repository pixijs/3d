# Driving bones

A character's bones moved from code while its clip plays. The Khronos fox (`model('gltf.Fox')` from
`examples/assets/manifest.ts`) runs its `Survey` clip; after each clip step the code turns its head towards a target,
blended with the clip's pose by a follow strength, and its tail's first bone copies a plain `Container3D` the pane
turns up. The rig shows through the fur, with the clip's gaze in ink, the code's gaze in pink out to the aim dot, and a
purple arc for the tail's lift. A loaded model's bones aren't scene nodes but numbered slots in a skeleton's flat
arrays: write one after the player has run, then mark the skeleton dirty.

![The orange fox standing three quarters on over the light checker floor with its rig drawn in ink through the fur, the head bone lit pink and the first tail bone purple; a pink arrow runs from its head to a pink dot tagged aim on the left, an ink arrow tagged clip points down towards the floor, and a purple arc curls up beside the tail; the pane in the top right shows Follow 1.00 and Tail lift 0.60](reference.png)

## API

- `Skeleton`, from `fox.skeletons[0]`: `indexOf(label)` finds a node's index by name (`b_Head_05`, `b_Tail01_012`),
  and `localPosition`, `localRotation` and `localScale` hold every node's pose relative to `parent[i]` in flat arrays,
  3 or 4 numbers a node. The code reads the head's rotation after the clip, writes the blend back at `head * 4`, and
  sets `skeleton.dirty = true` so the view rebuilds the pose.
- `skeleton.bindContainerBone(node, container)`: the tail's first bone copies the whole local transform of a
  `Container3D` that isn't in the scene, when the view draws or on `skeleton.updateWorld()`. The container starts at
  the bone's rest pose, and the clip still moves the bones below it.
- `Model3D` with `autoPlay: 'Survey'` and `autoUpdate: false`: the code calls `fox.player.update(ticker)` itself, so
  it writes the head after the clip has posed it. `fox.toLocal(aim, undefined, out)` puts the aim in the model's
  space, which is the skeleton's space for the fox.
- `Quaternion` (`fromArray`, `toArray`, `slerp`, `setFromUnitVectors`, `setFromAxisAngle`, `multiply`), `Matrix4`
  (`compose`, `premultiply`, `getInverse`), `Vector3` and `PointData3D`: `getBoneTransform` walks up `parent`
  composing each node's pose, and `aimRotation` takes the target into the neck's space and finds the turn that points
  the head's +x at it.
- `Material3D`: `matteFur` sets the fur's `roughness` to 1 through the `Scene3DSource`'s `material` map, since
  Fox.glb has no normals.
- `Plane` (`setFromNormalAndCoplanarPoint`) and `view3d.screenToWorld(point, plane, out)`: the pointer's ray meets a
  plane facing the camera, and the hit, clamped to a box in front of the face, is the target.
- `View3D`: the 3D scene inside pixi's stage, its `camera`, and `worldToScreen` to place the `clip` tag.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping, no panning and a polar limit above the floor.
- `Application`, `Assets` (loads the `Scene3DSource`), `Ticker`, `Point` and `FederatedPointerEvent` (the view's
  `globalpointermove`, `pointerdown` and `pointerup`) from `pixi.js`.

## Controls

- Move the mouse over the scene and the fox looks at it; the target stays in a box in front of its face. On a phone,
  tap to place it.
- Drag to orbit.
- Pane: `Follow` blends the head from the clip's pose (0) to the aim (1); `Tail lift` turns the tail's container up
  from rest, in radians.

## Files

- `index.ts`: the lesson. Loads the fox, writes the head after `player.update`, binds the tail to its container, and
  the pane.
- `bones.ts`: `getBoneTransform` and `aimRotation`, read from the skeleton's flat arrays, and the rig's `ALONG_BONE`
  and `TAIL_LIFT_AXIS`.
- `scene.ts`: `matteFur`, and `createTarget`, the point the pointer moves.
- `visuals.ts`: the rig, the two gazes, the aim dot, the lift arc and the `aim` and `clip` tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `fitPortrait`,
`SkeletonHelper`, `ArrowHelper`, `AngleHelper`, `DotHelper` and `LabelLayer`, with `THEMES`, `BRAND`, `themeFromUrl`
and `NARROW_BELOW`.

## See also

- [Playing clips](../animation_clips/README.md): the player that poses the bones before the code turns one.
- [Crowd](../animation_crowd/README.md): many skinned characters, each with its own player.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- animation_bones` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
