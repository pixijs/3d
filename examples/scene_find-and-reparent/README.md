# Find and reparent

Finding a node by its `label`, and moving it to a new parent with `addChild` or `reparentChild`. The logo's five
pieces stand on a board labelled `left`, a quarter turn from a second board labelled `right`, and the pane finds a
piece by label and moves it across. A node's `position` and `quaternion` are measured in its parent's space, so moving
a piece between boards that face different ways is a choice: keep the numbers and let the piece jump, or keep its place
in the world and rewrite the numbers.

![The pink PixiJS logo on the left of two white clay boards that stand a quarter turn apart, tagged left and right at their feet; the JS badge has a pink frame tagged js, and a pink arrow runs to it from the left board's origin, marked by its axes; the pane shows Find with label js, deep ticked and found js, and Move with the buttons addChild → right and reparentChild → right, parent left, position 1.22, 1.46, 0.16, Reset, and an empty Events log](reference.png)

## API

- `Container3D` with `label`: the two boards, built with `label`, `position`, `angle` and `parent`. The logo's pieces
  are nodes the kit labels `p`, `ixi`, `dotL`, `dotR` and `js`.
- `getChildByLabel(label, deep)`: `view3d.root.getChildByLabel('js', true)` finds the badge anywhere below the root;
  without `deep` it checks only the root's own children, the boards, so a piece's label finds `null`.
- `addChild`: `to.addChild(piece)` keeps the piece's `position` and `quaternion` as they are. They're measured in the
  board's space, so the piece jumps to the same spot on the new board, turned with it, and the position row doesn't
  change.
- `reparentChild`: `to.reparentChild(piece)` keeps the piece where it is in the world. It works out the piece's world
  transform on the spot and writes new `position`, `quaternion` and `scale` relative to the new board, so the piece
  doesn't move but the position row does. `rotation` and `angle` aren't rebuilt from the quaternion, so turn a
  reparented node through `quaternion`.
- `Container3D` events: on either move the old parent emits `childRemoved`, the piece `removed`, the new parent
  `childAdded` and the piece `added`, each passing the other node; the Events log shows all four.
- `Mesh3D`: each board's clay panel. `Box`, `Matrix4` (from `getGlobalTransform`, split with `decompose`) and
  `Vector3` place the frame, the arrow and the ghost in world space.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held in front of the boards by its azimuth limits.
- `View3D`: the 3D scene inside pixi's stage. `Application` and `Renderer` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane, Find: label picks a piece or a board to find, `deep` searches below the root's own children, and found reads
  the result's label, or `null`.
- Move: `addChild → right` and `reparentChild → right` (each names the other board) move the found piece there; they're
  disabled when the search found a board or nothing. parent and position read the piece's parent and `position`, and
  Reset puts the logo back. A jump leaves a ghost where the piece was. Events logs the four events of the last move.

## Files

- `index.ts`: the lesson. The labelled boards, `find`, `move` with each call, Reset and the event listeners.
- `controls.ts`: the pane: Find, Move and the Events log.
- `scene.ts`: each board's clay panel, and the camera and its orbit.
- `visuals.ts`: the frame and tag round the found node, the arrow from its parent's origin, the parent's axes or the
  root's dot, and the ghost a jump leaves.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo` and `LOGO_PIECES`,
`clayMaterial`, `roundedBox`, `fitPortrait`, `BoxHelper`, `ArrowHelper`, `AxesHelper`, `DotHelper`, `GhostHelper`,
`LabelLayer`, `ThemePane` and `LoadingScreen`.

## See also

- [Parents and children](../scene_hierarchy/README.md): how a child moves, turns and scales with its parent.
- [Transforms](../scene_transforms/README.md): the `position` and `quaternion` the two calls keep or
  rewrite.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- scene_find-and-reparent` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
