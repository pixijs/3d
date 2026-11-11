# Parents and children

A child moves, turns and scales with its parent, and `visible` hides a whole branch. A clay orrery shows it: the planet
sits 2.5 along its `orbit`'s x, an empty `Container3D` at the sun's centre, and the moon 0.75 along the planet's.
Turning the orbit carries the planet round the sun, and turning the planet carries the moon, while neither one's own
numbers change. The idea to leave with: a node's `position` is in its parent's space, so moving a parent moves its
whole subtree.

![A clay orrery over the light checker floor: an orange sun tagged sun, with the orbit's axes at its centre and a tag orbit above, a purple planet tagged planet on the right of the inner ring with its own axes, an ink line from the sun's centre out to it, a small lilac moon tagged moon just beyond the planet along its x axis, and a sky blue outer planet at the back left of a wider ring; the pane shows sun.position.x 0.00, orbit spin 0.45, orbit.visible ticked, planet spin 1.60 and planet.scale 1.00](reference.png)

## API

- `Container3D`: `orbit` and `outerOrbit` are empty nodes at the sun's centre. They draw nothing, but their children
  live in their space, so turning one with `rotation.y` swings its planet round the sun.
- `Mesh3D` with `label`, `x` or `y`, `rotation` and `material`: the sun, planets and moon. `addChild` builds the tree
  (`sun` holds both orbits, `orbit` the planet, the planet the moon), and nothing ever writes the planet's or the
  moon's position.
- `visible`: `orbit.visible = false` hides the orbit, the planet and the moon, and they keep moving while hidden. The
  outer branch, a sibling, is untouched.
- `scale`: `planet.scale = value` scales the planet and everything under it, so the moon grows and moves out with it.
  Each body takes its size from its geometry rather than its scale, since a parent's scale would push its children
  out.
- `SphereGeometry` with `radius`, `widthSegments` and `heightSegments`: each body.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit with `enableDamping`, no pan, distance and tilt limits, and
  `rotate` to retilt when a phone turns. It's named `orbitCamera`, so `orbit` means only the scene node.
- `View3D`, whose `worldToScreen` places the planet and moon tags, and `Vector3`, for `getGlobalPosition`.
- `Application` and `Point` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `sun.position.x` slides the sun, and the whole system with it; orbit spin sets the orbit's turn rate;
  `orbit.visible` hides its branch; planet spin sets the planet's turn rate, which carries the moon; `planet.scale`
  scales the planet, its moon and the moon's distance.

## Files

- `index.ts`: the lesson. The tree, each parent's spin and the pane.
- `visuals.ts`: the orbit's and the planet's axes, the line out to the planet, both rings, and the tags naming the
  focal branch's levels from each node's `label`. The helpers are children of the nodes they explain, so they turn,
  scale and hide with them.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayMaterial`, `fitPortrait`, `AxesHelper`,
`ArrowHelper`, `PathHelper`, `LabelLayer`, `ThemePane` and `LoadingScreen`.

## See also

- [Transforms](../scene_transforms/README.md): a single node's transform in detail.
- [Find and reparent](../scene_find-and-reparent/README.md): finding a node by `label` and moving it to a new parent.
- [Look at](../scene_look-at/README.md): `lookAt` and moving points between nodes' spaces.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- scene_hierarchy` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
