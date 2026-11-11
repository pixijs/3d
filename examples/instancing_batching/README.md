# Batching and culling

Thousands of plain `Mesh3D`s in a handful of draw calls, and the culling that skips what the camera can't see. 2,000
clay pieces in seven shapes and eight colours cover a disc, and meshes that share a geometry and a kind of material
batch into instanced draws on their own. On WebGL each shape is one draw whatever its colours, so the field takes
seven; on WebGPU each colour of a shape draws on its own until a shape needs more than 16 draws, then they merge.
The main view culls against a second camera's frustum, the scout's, so you watch the cull from outside: as the scout
sweeps round the disc, only the pieces in its pink frustum draw, and every other piece leaves just its floor dot.

![A disc of floor dots on the light checker floor, with clay pieces in pinks, purples, blues and a few oranges standing only inside the pink frustum of a small camera tagged scout that looks out from the disc's middle; in the bottom right an inset titled what the scout sees shows the whole field from the scout; the pane shows Count 2000, Shapes 7, Colours 8, cull gpu, cullFrustum scout.frustum, Sweep ticked and Scout aim 165, with drawCallCount 60 and Drawn 436](reference.png)

## API

- `Mesh3D` with `geometry`, `material`, `scale` and `parent`: nothing asks for batching. Meshes that share a geometry
  and a kind of material (the same class and render state, so the same shader) land in one instanced run. On WebGL
  the run is one draw and each mesh's colour travels with it per instance; on WebGPU it's a draw per material, merged
  into one only past 16. `destroy()` leaves the kit's shared geometry and material alone.
- `geometry.bounds3D`: its `min.y` rests each piece on the floor.
- `View3D` `cull`, a `CullMode`: `'off'`, `'cpu'` or `'gpu'`, the default. WebGL has no compute pass, so it culls on
  the CPU there. A new mode takes effect on the next render and rebuilds nothing.
- `camera.cullFrustum`: the frustum the view culls against, the camera's own `frustum` unless set. Set to
  `scout.frustum`, the main view draws only the pieces the scout can see.
- `Camera3D` (`fov`, `near`, `far`, `renderTexture`, `position`, `parent`) and `lookAt`: the scout, which draws into
  a texture and turns like a radar beam.
- `MeshPass` with `name: 'opaque'` and `camera: scout` in `view3d.passes`: adds a pass that draws the opaque meshes
  again from the scout, whose `frustum` the view rebuilds before any pass draws.
- `RenderGraphDebugger` from `@pixi/3d/extras`: `capture()` a few times a second, read for `summary.drawCallCount`
  and for each opaque draw's `drawnInstanceCount`, the pieces that survived the cull.
- `stage.key.castShadow = false`: a shadow pass culls against the light's own volume, not `cullFrustum`, and would
  draw the whole field again.
- `seededRandom` and `Vector3` in `scene.ts`: each piece's shape, colour and turn, kept per piece as the count changes.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the field; `zoom` backs it off beside the panels.
- `Application`, `RenderTexture.create` (with `scaleMode` set at creation) for the scout's picture, and
  `UPDATE_PRIORITY` to read each capture after the render, from `pixi.js`; the `Renderer` type and `Texture` from
  `pixi.js` too.

## Controls

- Drag to orbit.
- Pane: the `Batching` folder sets the `Count`, `Shapes` and `Colours` of the pieces and reads the frame's
  `drawCallCount`. The `Culling` folder sets the view's `cull` mode and its `cullFrustum` (`scout.frustum` or
  `camera.frustum`), and reads `Drawn`, the pieces that survived the cull.
- The scout sweeps round the disc on its own, since watching the cull change is the lesson. `Sweep` pauses it, and
  moving `Scout aim` turns the scout by hand and pauses it too.

## Files

- `index.ts`: the lesson. The field, the scout and its pass, `cullFrustum`, and the debugger's counts.
- `controls.ts`: the pane, binding `cull` to the view and the scout's rows to its sweep.
- `scene.ts`: each piece's shape, colour and place on the disc, the scout's sweep, and the camera's back-off beside
  the panels.
- `visuals.ts`: the scout's frustum and tag, a dot under every piece, and the inset of the scout's picture.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry` at `'low'` detail,
`clayMaterial`, `FrustumHelper`, `PointsHelper`, `InsetView`, `LabelLayer`, `ThemePane`, `LoadingScreen` and
`fitPortrait`.

## See also

- [BatchedMesh3D](../instancing_batched-mesh/README.md): 100,000 shapes in one scene node, with no `Mesh3D` each.
- [Level of detail](../instancing_lod/README.md): fewer triangles for the meshes that stay, as they move away.
- [Seeing the frame](../debug_graph-overlay/README.md): more of what `RenderGraphDebugger` shows about a frame.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- instancing_batching` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
