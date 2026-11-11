# BatchedMesh3D

One scene node that draws up to 100,000 clay shapes in a few dozen draw calls. A `BatchedMesh3D` holds a fixed number
of slots, each a geometry, a material, a matrix and the passes that draw it, with no scene node per shape. Slots that
share a geometry and a shader draw as one instanced draw, so on WebGL a rope of seven shapes in eight clay colours
round the floor costs 14 draws, seven in each of two passes, at any size. WebGPU's opaque pass binds each colour on its
own, so it draws each shape once per colour, 56 draws, and its shadow pass seven, 63 in all. A band runs round the
ring, lifting the slots it passes, by writing their matrices straight into the batch's buffer.

![A ring of 100,000 tiny clay shapes in pinks, purples and blues lying round the light checker floor, one stretch on its left, near the front, lifted into a hump; a small box on the ring's front right is joined by a leader to an inset titled up close in the bottom right, where cubes, spheres, tori and the other clay shapes show one by one; the pane shows size 100,000, visible share 1.00, draws 63, and an every slot folder with shapes 7, colours 8 and passes OPAQUE | SHADOW](reference.png)

## API

- `BatchedMesh3D` (`size`, `label`, `parent`): `size` is fixed for the batch's life, so a new size calls `destroy()`
  and builds another; `destroy()` leaves the shared geometries and materials. Its `cull` stays at the default,
  `'off'`, since the whole ring is in view.
- `setGeometryAt`, `setMaterialAt`, `setMatrixAt` and `setPassesAt`: each slot's four parts. A new slot's matrix is
  all zeros and it has no passes, so every slot gets both once. `setPassesAt` moves the slot in or out of the draws of
  each pass it touches and rebuilds the slot's shader when it joins one, so it's for set-up and switches, not every
  frame.
- `RenderPassBit` `OPAQUE` and `SHADOW`: the passes a slot draws in. A slot doesn't take them from its material the
  way a `Mesh3D` does.
- `setVisibleAt`: hides or shows a slot and keeps its geometry, material, matrix and place in its draw, so a flip
  rebuilds nothing. The share hidden follows a shuffled order, so the ring thins evenly.
- `matrices` (`data`, `stride`, `offset`) and `matrices.update(first, count)`: the band writes float 13 of each slot's
  16, translation y, in place, then marks only the slots it changed.
- `Matrix4` `compose` with a `Quaternion` from `setFromEuler`, and `seededRandom`, in `scene.ts`: each slot's matrix
  at rest, from a seeded layout, so every run builds the same ring.
- `view3d.shadowFilter = 'pcf'`, the cheaper filter, since every slot samples the shadow map; `Box.fromCenterSize`
  pins `stage.key.shadow.bounds`, since past 256 casters the engine stops fitting the box to them.
- `Vector3`, `getGlobalPosition`, `distanceTo`, `lookAt` and the inset camera's `fov`, `near` and `far` in
  `visuals.ts`: the loupe's camera looks from the main camera at one slot through a narrow lens.
- `View3D`: the 3D scene inside pixi's stage, its `camera` and `worldToScreen`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`, and `isMobile`, which starts a phone or tablet at 25,000 slots. `DEG_TO_RAD`, `Point`
  and `Rectangle` from `pixi.js` size the loupe and draw its outline.

## Controls

- Drag to orbit.
- Pane: `size` builds the batch again at 1,000 to 100,000 slots; `visible share` hides a share of the slots; the
  read-only `draws` counts the main view's draws: one per shape in each pass on WebGL, and on WebGPU one per shape and
  colour in the opaque pass. The `every slot` folder sets every slot's `shapes` and `colours` (how many of each are in
  use) and `passes` (`OPAQUE | SHADOW`, `OPAQUE` or `SHADOW`).
- The band runs round the ring on its own; it's the per-frame matrix write the lesson shows.

## Files

- `index.ts`: the lesson. Building the batch, every `BatchedMesh3D` call the pane makes, and the band's matrix writes.
- `controls.ts`: the pane, and the draw count worked out from its settings.
- `scene.ts`: where each slot sits in the rope, how it's turned and sized, its colour, and the order slots show in.
- `visuals.ts`: the loupe, an inset that draws a patch of the ring up close, and its outline and leader on the main
  view.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry` at `'low'` detail and
`clayMaterial` in every `CLAY_COLORS` colour, `InsetView`, `ScreenLines`, `viewRect`, `ThemePane`, `LoadingScreen`
and `fitPortrait`.

## See also

- [Batching and culling](../instancing_batching/README.md): many plain `Mesh3D`s batched for you, and culling.
- [Per-instance data](../instancing_instance-data/README.md): moving thousands of slots in a shader bit instead of
  rewriting matrices.
- [Level of detail](../instancing_lod/README.md): trading a shape's detail as it moves away.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- instancing_batched-mesh` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
