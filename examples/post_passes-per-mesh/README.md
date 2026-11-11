# Passes per mesh

A mesh joins or leaves a render pass on its own, whatever its material says. Twelve clay shapes share two materials,
six lilac and six orange, yet `mesh.enablePass('outline')` rims one shape while its five twins stay plain; switch the
pane to `material.enablePass` and hovering one orange shape rims all six. A sky clay capsule has left `'opaque'` with
`disablePass('opaque')`: nothing of it draws, but it's still in the shadow pass, so its shadow walks up and down an open
lane through the field with nothing above it. Hover the air over that shadow and its outline shell draws as a solid
pink silhouette; tap it and `enablePass('opaque')` brings it into view.

![Twelve clay shapes floating in three rows over the light checker floor, lilac and orange in a checkerboard, split by an open lane down the middle that slim capsules line in the back two rows; their shadows fall back and to the right, and a hot pink rim circles the front orange sphere beside the lane. In the lane a capsule-shaped shadow lies on the floor under nothing, with a leader line rising from the empty spot to a tag reading shadow only; the pane in the top right shows Join by mesh.enablePass and the hidden capsule folder with opaque off, castShadow on and Wander on](reference.png)

## API

- `OutlinePass` from `@pixi/3d/extras`, in `View3D`'s `passes`, with `width` (0.07, in each mesh's own units) and
  `color` (the kit's hot pink): a `MeshPass` named `'outline'` that draws each member again as an inverted shell a
  little larger than the mesh, so a rim shows round it. Its shader compiles the first time a mesh joins, a stall on
  the first hover, so the front orange sphere joins at boot, under the loading screen.
- `Mesh3D` `enablePass(name)` and `disablePass(name)`: put one mesh in a pass or take it out, whatever its material
  says, while the other meshes sharing the material stay as they were. A mesh's own call outranks its material's from
  then on, and no call hands the choice back, so the pane's material mode starts from fresh shapes. `disablePass`
  does nothing for a pass name nothing has joined yet.
- `material.enablePass(name)` and `disablePass(name)`: join or leave a pass for every mesh that wears the material.
  `clayMaterial` hands back one shared material per colour, so in material mode one hover rims a whole colour.
- `disablePass('opaque')`: the capsule draws nothing in the main pass but stays in `'shadow'`, so it casts with no
  body, as a shadow proxy or a first-person body would. It still picks and still joins `'outline'`, whose shell then
  shows as a solid silhouette, since no body stands in front of its inside. `enablePass('opaque')` undoes it.
- `castShadow`: the `'shadow'` pass under another name; setting it is `enablePass('shadow')` or
  `disablePass('shadow')`.
- `eventMode`, `hitVolume: 'geometry'` and `cursor: 'pointer'`, which `index.ts` picks for each `Mesh3D` and
  `scene.ts` passes to its constructor (typed from `Mesh3DOptions`), with listeners for `pointerenter`,
  `pointerleave` and `pointertap`. The shapes are `'static'`; the capsule moves, so it's `'dynamic'`, which picks
  again under a still pointer and gives it enter and leave as it walks in and out from under one. A shape takes the
  outline on `pointerenter` only while `buttons` is 0, so an orbit drag across the field leaves it where it was, and
  on `pointertap`, since a touch has no hover.
- `Mesh3D` `destroy()`: drops the old field when the mode changes, keeping the shared geometry and materials.
  `Container3D` is the shapes' parent. A `Vector3` from `@pixi/3d` and a `Point` from `pixi.js` carry the capsule's
  foot and head to the screen through `view3d.worldToScreen`, so its tag rides just over where its head would be.
- `View3D` and its `camera`; `OrbitCamera` from `@pixi/3d/extras`, kept high enough to see down the lane.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit. Hover or tap a shape to move the outline onto it; it stays on the last one entered. Hover the air
  over the moving shadow to outline the hidden capsule, and tap it to show or hide it.
- Pane: `Join by` picks `mesh.enablePass` (one shape) or `material.enablePass` (every shape of its colour). The
  `hidden capsule` folder's `opaque` mirrors the tap, `castShadow` takes it out of the shadow pass too, and `Wander`
  stops its walk.

## Files

- `index.ts`: the lesson. The outline pass, every `enablePass` and `disablePass`, how each mesh hears the pointer,
  the hover and tap, the mode switch and the pane.
- `scene.ts`: the field of twelve shapes either side of an open lane, the hidden capsule and its walk up and down
  that lane, and the key light up on the left that lays every shadow back and to the right.
- `visuals.ts`: the tag over the capsule's empty spot, `shadow only`, or `nothing drawn` once it leaves the shadow
  pass too; it's hidden while the capsule is drawn or outlined.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `form: false` and its key light moved and
brightened on the dark theme, so the shadows read on both floors; `shadowOverFloor`, `clayMaterial` and
`clayGeometry` (with `ClayShape` and `ClayColor`), `LabelLayer`, `ThemePane`, `LoadingScreen`, `fitPortrait`, and
`BRAND`, `THEMES` and `themeFromUrl` from the palette.

## See also

- [Outlines and wireframes](../post_material-passes/README.md): passes a material joins by name, and the outline's
  width and colour.
- [Custom mesh pass](../post_custom-mesh-pass/README.md): a `MeshPass` of your own, with its own render state and
  stage.
- [Shadows](../shadows_basics/README.md): the `castShadow` and `receiveShadow` flags, and the shadow map behind them.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_passes-per-mesh` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
