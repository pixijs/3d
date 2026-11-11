# Custom mesh pass

A `MeshPass` of your own: an x-ray that draws chosen meshes a second time, in one flat colour, through the wall in
front of them. Three clay critters march behind a brick wall the camera can't see over. The sphere and the capsule have
joined the pass by name, so their silhouettes show on the wall's face; the cube hasn't, so it stays hidden. The pass's
stage and colour are fixed when it's built, so changing either builds a new pass.

![A white clay brick wall over the light checker floor, with a flat sky-blue circle and a sky-blue pill on its face where the sphere and the capsule hide behind it; the inset in the bottom right, titled behind the wall, from above, shows the scene without the x-ray, a pink sphere, a purple cube and an orange capsule behind the wall; the pane shows color 0x38bdf8, depthTest off, stage afterOpaque, and the in 'xray' folder with sphere and capsule ticked and cube not](reference.png)

## API

- `MeshPass` with `name: 'xray'`, `stage`, a `description` and a `descriptor` of `{ state, shaderDescriptor }`:
  redraws every mesh whose material joined `'xray'`, with its own shader and render state. `MeshPass['stage']` places
  it: at `'afterOpaque'` the silhouettes land on the wall; at `'beforeOpaque'` the opaque scene paints over them.
- `solidMeshDescriptor({ color })` from `@pixi/3d/extras`: the shader, one flat colour with no lighting, so the example
  has no shader file of its own. The colour is a constant in that shader, so a new colour means a new pass.
- `material.enablePass('xray')` and `disablePass('xray')`: join and leave the pass. Every mesh wearing a member
  material joins with it; each critter wears its own clay colour, so it joins alone.
- `View3D` `passes`: a rebuild swaps the pass in place with `view3d.passes.map(...)`, keeping the inset's passes, and
  the graph rebuilds on the next render. The view never destroys a pass it drops, so the old one gets `destroy()`.
- `Mesh3D` `invalidate()`: after `depthTest` flips, each member records its draw again, since WebGL and WebGPU both
  keep drawing with the old state until then. `Mesh3D`, `Container3D`, `Geometry3D` and `PointData3D` build the wall
  and critters.
- `OrbitCamera` from `@pixi/3d/extras`: fenced in front of the wall and below its top.
- `State` from `pixi.js`: the pass's render state, `depthTest` and `depthMask` off, so the draw shows through the wall
  and leaves the scene's depth alone on WebGPU too. The pass reads it by reference: flipping `depthTest` needs no new
  pass.
- `Application` and `Rectangle` from `pixi.js`: `app.screen`, which the inset reads to pick its size.

## Controls

- Drag to orbit.
- Pane: `color` and `stage` (`beforeOpaque` or `afterOpaque`) build a new pass; `depthTest` flips the pass's `State`,
  and on, the silhouettes go; the `in 'xray'` folder puts `sphere`, `cube` and `capsule` in or out of the pass.

## Files

- `index.ts`: the lesson. The pass, its `State`, the rebuild and the membership.
- `scene.ts`: the brick wall and the three critters, with their march and hops.
- `visuals.ts`: the inset that looks down over the wall at the critters, with no x-ray.
- `controls.ts`: the pane's rows, each calling a function `index.ts` passes in.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`; `InsetView` with a same-scene camera, which
appends its own passes to `view3d.passes`; `clayMaterial`, `clayGeometry` and `roundedBox`; `ThemePane`,
`LoadingScreen`, `fitPortrait`, and `BRAND`, `THEMES`, `themeFromUrl` and `ClayColor` from the palette.

## See also

- [Outlines and wireframes](../post_material-passes/README.md): `OutlinePass` and `WireframePass`, two ready-made
  `MeshPass` subclasses that materials join the same way.
- [Second cameras](../cameras_render-to-texture/README.md): a `MeshPass` with a `camera`, drawing the scene again from
  another camera.
- [Render graph](../post_render-graph/README.md): a `Pass3D` of your own, and where each stage sits in the frame.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_custom-mesh-pass` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
