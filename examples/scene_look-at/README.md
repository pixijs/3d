# Look at

Pointing at things: `lookAt` turns a node at once so its +z faces a world point, and `toLocal` and `toGlobal` carry
points between nodes' spaces. Three clay turrets track a target that flies a loop in front of them. Each turret aims an
empty twin of its head with `lookAt`, and the head follows at a set turn rate with `quaternion.slerp`; once the target
sits dead ahead in the head's own space, the turret fires a beam from its muzzle. Each head starts aimed at the target,
so the picture opens with all three firing at it. The idea to leave with: `toLocal` answers "where is that, as this
node sees it", and `toGlobal` answers "where is this point of mine in the world".

![Three clay turrets in a shallow arc on the light checker floor, all aimed at a pink octahedron target floating up and to the left and firing pink beams at it from their muzzles, with a blue +z arrow past each barrel; the left turret shows its own x and y axes and a dark dot at its barrel's end tagged muzzle, and red and blue arrows on the floor mark the world origin; the pane shows Fly ticked, target.position x -2.00, y 2.95 and z -5.10, Turn rate 45°/s, Head left and toLocal (0.0, 0.0, 3.7), the target dead ahead](reference.png)

## API

- `lookAt(point)`: turns a node at once so its +z faces a world point. Each frame `aim.lookAt(target.position)` turns
  the head's twin, an empty `Container3D` that shares the head's parent and position, so their quaternions compare.
  The plain call also starts each head on the target, and points each beam at it.
- `quaternion.angleTo` and `quaternion.slerp`: `angleTo` measures the turn left between the head and its twin, and
  `slerp` turns the head one step of it, so the head turns at a steady rate in degrees a second.
- `toLocal(point, from, out)`: `head.toLocal(ORIGIN, target, targetLocal)` carries the target's origin into the head's
  space. x and y near 0 mean dead ahead, and z is how far, so the turret fires once x and y fall inside a small radius.
- `toGlobal(point, out)`: `head.toGlobal(MUZZLE, muzzle)` turns the barrel's open end, a `PointData3D` in the head's
  space, into the world point a `Vector3` holds, where the world-space beam starts.
- `getGlobalPosition`: each head's pivot in world space, read once since the turrets stand still.
- `Mesh3D`, `Material3D` and `CylinderGeometry`: the turrets, the target, and the beam, a unit cylinder stretched
  along its `scale.z` to the target.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit with `enableDamping`, no pan, distance and tilt limits.
- `View3D`: the 3D scene inside pixi's stage. `Application`, `DEG_TO_RAD` and `Point` from `pixi.js`.

## Controls

- Drag to orbit.
- The target flies its loop on its own, because watching the heads lag, catch it and fire is the lesson. Pane: Fly
  pauses the flight; moving the target.position folder's x, y or z pauses it too, so the target stays where you put
  it. Turn rate sets how fast the heads turn; Head picks the turret whose axes, muzzle and toLocal reading show, and
  toLocal reads the target in that head's space.

## Files

- `index.ts`: the lesson. The twins, `lookAt`, the turn at the turn rate, `toLocal` and `toGlobal`, and the beams.
- `controls.ts`: the pane, which pauses the flight when a position row moves.
- `scene.ts`: the three clay turrets and their beams, and the target and its loop.
- `visuals.ts`: each head's +z arrow, the line from each head to the target, the selected head's axes and muzzle,
  and the world origin.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayMaterial`, `EnamelMaterial`,
`clayGeometry`, `roundedBox`, `roundedCylinder`, `fitPortrait`, `ArrowHelper`, `DotHelper`, `LabelLayer`, `ThemePane`
and `LoadingScreen`.

## See also

- [Transforms](../scene_transforms/README.md): the `quaternion` that `lookAt` writes, and the other
  ways to turn a node.
- [Parents and children](../scene_hierarchy/README.md): the parent spaces `toLocal` and `toGlobal` move between.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- scene_look-at` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
