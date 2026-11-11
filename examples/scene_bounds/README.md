# Size and bounds

How big a node is, and how to make it a given size. `getLocalBounds()` measures a node and everything under it in the
node's own space, so its own scale and position don't count; `width`, `height` and `depth` are that box times the
scale. Fitting a model to a box is three steps: measure it, scale it, then move it so its bounds' centre sits on the
box's. The picture fits a clay capsule, the logo file and a swarm of 160 shapes, each a very different size, into three
identical cubes, and the swarm's `boundsVolume`, a fixed box measuring reads in place of its 161 nodes, shows as its
frame.

![Three identical ink wireframe cubes in a row on the light checker floor, seen through an orthographic camera: a sky blue capsule, the pink PixiJS logo and a lilac swarm of small shapes, each scaled to fit its cube, with a pink frame round each model's measured bounds; the logo's frame is tagged bounds and the swarm's larger frame boundsVolume; the pane shows Box size 2.00, Fit Keep shape, boundsVolume and Show bounds ticked, and Measure reading the logo's Local bounds 7.34 × 2.88 × 0.82 and Size 2.00 × 0.78 × 0.22](reference.png)

## API

- `Container3D` `getLocalBounds(out)`: fills a `Box` with the model's bounds in its own space; the fit reads its
  `width`, `height` and `depth`, and `getCenter` into a `Vector3`.
- `Container3D` `scale` and `setSize`: Keep shape scales evenly by the longest side, `scale.set(size / longest)`;
  Stretch calls `setSize(size)`, which scales each axis on its own so the model fills the cube.
- `Container3D` `position`: centring moves the model so its bounds' centre, times its scale, sits on the cube's
  centre. Skip centring leaves the model's own origin on the cube's floor.
- `Container3D` `getSize(out)`: the size the model shows at in its slot, its bounds times its scale, as a `Size3D`,
  measured once for all three sides.
- `Container3D` `boundsVolume`: a `Box` made with `Box.fromCenterSize` that bounds the swarm wherever it flocks, so
  measuring reads it rather than walking every shape. `null` takes it away.
- `Model3D.from(source)`: the logo, built from a `Scene3DSource` that `Assets.load` from `pixi.js` loads raw, so the
  fit has to centre it.
- `Mesh3D`: the capsule and the 160 swarm shapes, and the meshes the logo's enamel replaces.
- `view3d.camera.mode = 'orthographic'`, so the three cubes look identical wherever they stand.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit with `enableDamping`, no pan, and `minZoom` and `maxZoom`.
- `View3D`: the 3D scene inside pixi's stage. `Application`, `Renderer` and `Point` from `pixi.js`.

## Controls

- Drag to orbit, scroll to zoom.
- Pane: Box size sets the cubes' side; Fit picks Keep shape, Stretch or Skip centring; `boundsVolume` gives the swarm
  its fixed box or takes it away; Show bounds shows the pink frames. Measure: Model picks the capsule, the logo or the
  swarm, and Local bounds and Size read its `getLocalBounds()` and `getSize()`.

## Files

- `index.ts`: the lesson. The three models, `fitToBox` and the swarm's `boundsVolume`.
- `controls.ts`: the pane and its Measure readouts.
- `scene.ts`: the logo's enamel, the swarm and its flocking, and the layout that lines the boxes up for the screen.
- `visuals.ts`: the ink cubes, the pink bounds frames and the bounds and `boundsVolume` tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `LOGO_URL`, `EnamelMaterial`, `clayMaterial`,
`clayGeometry`, `BoxHelper`, `LabelLayer`, `ThemePane` and `LoadingScreen`.

## See also

- [Transforms](../scene_transforms/README.md): the `scale` and `position` the fit writes.
- [Parents and children](../scene_hierarchy/README.md): how a parent's transform carries the subtree measured here.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- scene_bounds` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
