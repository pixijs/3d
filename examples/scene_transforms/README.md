# Transforms

Position, rotation and scale: the local transform every node carries, each part measured in its parent's space.
`position` places the node's origin as an offset from its parent's; `angle` (degrees) and `rotation` (radians) are one
Euler turn in two units, and `quaternion.setFromAxisAngle` turns the node about any axis; `scale` stretches it along its
own axes; and `origin` is the point it turns about, which is how a door swings on its hinge. The picture shows the
logo's P moved off the root and turned 45° beside its unturned ghost, and a door swung open on its hinge beside a ghost
of the same door turning about its middle.

![The pink P of the PixiJS logo with its own x, y and z axes, an ink arrow from a dot tagged root on the floor to its centre and a pink dial under it showing its turn about y, beside a grey unturned ghost of the P; on the right an orange door in a lilac frame swung open on its left edge, a pink dot tagged origin on the hinge line and an arc for its swing, with a grey ghost of the door turned about its middle; the pane shows the letter's position -1.00, 1.50, 1.00, angle.y 45, rotation.y 0.79, turn in use angle and scale 1.00, the quaternion's axis 0.00, 1.00, -1.00 and angle 1.57 radians, and the door's origin.x -0.50 and angle.y 70](reference.png)

## API

- `position`: assigned a whole `PointData3D` (`letter.position = pose.position`), the letter's offset from its
  parent's origin, the root.
- `angle` and `rotation`: one Euler turn, in degrees and in radians. The pane sets `angle.y` and reads `rotation.y`
  beside it, the same turn in the other unit. Assigning the whole `angle` makes it the turn in use again.
- `quaternion.setFromAxisAngle(axis, angle)`: turns the letter about any axis, a unit `Vector3` made with
  `normalize`. The node keeps the Euler turn and the quaternion apart, and the one written last turns it.
- `scale`: assigned a whole `PointData3D`, stretching the letter along its own axes, which stretch with it.
- `origin`: the point in the node's own space that it turns about. The door, a `Mesh3D` built with `origin` on its
  left edge, swings on its hinges as `angle.y` changes; at `origin.x` 0 it turns about its middle.
- `Container3D` and `Mesh3D`: the door's lilac frame and hinge knuckles, which stay put while the door turns inside
  them. `getLocalBounds` gives the letter's and the door's own `Box`, which hang the dial under the letter's foot and
  size the door's hinge line and swing.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit with `enableDamping`, no pan, distance and tilt limits.
- `View3D`: the 3D scene inside pixi's stage. `Application` and `Point` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane, letter: `position`, `angle.y` (which makes angle the turn in use), `rotation.y` read-only beside it, turn in
  use to pick which turn is written last, and `scale`. quaternion: the axis and angle (radians) passed to
  `setFromAxisAngle`; moving either makes the quaternion the turn in use. door: `origin.x` moves the point it turns
  about, and `angle.y` swings it. Reset returns to the opening pose.

## Files

- `index.ts`: the lesson. The letter, the door with its `origin`, and `applyPose`, which makes every transform call.
- `controls.ts`: the pane, which writes a plain pose that `applyPose` copies into the scene.
- `scene.ts`: the door's lilac frame and white hinge knuckles.
- `visuals.ts`: the letter's axes, its ghost, the arrow from the root, the Euler dial or the quaternion's axis and
  curl, and the door's turning point, hinge line, swing and ghost.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `clayMaterial`, `roundedBox`,
`roundedCylinder`, `fitPortrait`, `AxesHelper`, `ArrowHelper`, `AngleHelper`, `DotHelper`, `GhostHelper`,
`LabelLayer`, `ThemePane` and `LoadingScreen`.

## See also

- [Parents and children](../scene_hierarchy/README.md): how a parent's transform carries its children.
- [Look at](../scene_look-at/README.md): `lookAt`, which writes the `quaternion` for you.
- [Size and bounds](../scene_bounds/README.md): setting `scale` and `position` to fit a model to a box.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- scene_transforms` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
