# Seeing the frame

`GraphDebugOverlay` records a view's frames and steps back through them, and `RenderGraphDebugger` captures one frame as
data. A frame is a list of render passes run in order, and each scene pass keeps its draw calls from frame to frame:
moving or hiding a mesh reuses them, while adding or removing one, swapping its material or making it see-through
repacks them: the draws stay and only their ranges move. A mesh of a kind no draw has gets a draw of its own at the end,
and about a second later the pass rebuilds to sort it in. Each capture says which, and why. The picture shows the logo
over a sphere, a puck and an octahedron, with a pink twin at the left. On WebGL the twin shares the sphere's draw, so the
opaque pass draws 10 meshes in 9 draws; WebGPU gives each material its own draw until a run of them would pass 16, so
it draws 10.

![The pink PixiJS logo over a purple sphere, a lilac puck and a pale sky octahedron on the light checker floor, with a pink twin sphere floating at the left; the dark RenderGraph Debugger panel in the top-right corner says it's ready beside a Record button, and the pane under it shows the last capture: captureId 3, passes shadow, depthClear, background and opaque, meshes 10, draws 10, drawn 10, status reused and no causes, with twin and twin.visible on, puck.material lilac and octahedron clay](reference.png)

## API

- `RenderGraphDebugger` from `@pixi/3d/extras`, with `view`: `capture()` returns a `GraphDebugSnapshot` of the frame
  just drawn. It compares with the capture before, so the first after a change says what the change cost.
- `GraphDebugSnapshot` from `@pixi/3d/extras`: `graph.passes`, each with its `name`, `active` and `passIdx`, its place
  in the run order; `batches[0]`, the scene's batch, whose `passes` give each pass's `renderableCount`, `drawCallCount`,
  `drawnInstanceCount`, and `drawBuild.status` (`'reused'`, `'repacked'` or `'rebuilt'`, among others) with
  `drawBuild.causes`, each with a `code`; and `captureId`.
- `GraphDebugOverlay` from `@pixi/3d/extras`, with `view`, `renderer` and `maxRecordedFrames`: the panel pinned to the
  page's top-right corner. Without `renderer`, Record captures nothing unless you call `overlay.refresh()` after each
  render. `destroy()` takes it off the page.
- `Mesh3D` with a `label`, which the overlay and the snapshot show. Meshes that share a geometry and a shader share a
  draw on WebGL, and on WebGPU once a run of their materials would pass 16 draws. `visible = false` keeps a mesh in its
  draw, which skips it; `removeFromParent()`, `addChild` and a new `material` repack the draws, and a mesh of a kind no
  draw has rebuilds them about a second later; a see-through clay (`alphaMode: 'blend'`) moves to the transparent pass,
  which sorts back to front every frame and rebuilds its draws only when that order changes.
- `View3D`, and `OrbitCamera` from `@pixi/3d/extras`. `UPDATE_PRIORITY.UTILITY` and `Application` from `pixi.js`: the
  capture runs on the ticker after the app's render, which runs at `LOW`, so it reads the frame just drawn.

## Controls

- Drag to orbit.
- Overlay: press `Record`, change the scene, press `Stop`, then drag the frame slider through the recorded frames.
  `‹ Change` and `Change ›` jump only between frames that rebuilt draws or recorded a bundle, so they skip a repack.
- Pane, `Debug`: `overlay` puts the overlay on the page or takes it off; `live capture` captures four times a second;
  `Capture` takes one and logs the whole snapshot to the console. Turn live capture off to make several changes, then
  press `Capture` for one answer to them all. `Last capture`: `captureId`, `passes`, `meshes`, `draws`, `drawn`,
  `status` (`reused`, `repacked` or `rebuilt`) and `causes`. `Change the scene`: `twin` adds or removes the twin, `twin.visible` hides it,
  `puck.material` swaps the puck's clay, and `octahedron` makes it see-through.

## Files

- `index.ts`: the lesson. The debugger, the overlay, the captures and the changes.
- `controls.ts`: the pane's three folders.
- `scene.ts`: the three labelled clay shapes, and the motion that keeps every shape moving.

From the theme kit (`examples/shared/theme/README.md`): `loadPixiLogo`, `clayGeometry`, `clayMaterial`, `ThemeStage`,
`ThemePane` with `top` set so it sits under the overlay, `LoadingScreen` and `fitPortrait`. There are no helpers: they
would add meshes and draws of their own to the numbers the lesson explains.

## See also

- [Render graph](../post_render-graph/README.md): the passes the debugger lists, and adding your own.
- [Batching and culling](../instancing_batching/README.md): when meshes share a draw, and when they're skipped.
- [Geometry thumbnails](../debug_thumbnails/README.md): the generator the overlay draws its geometry cards with.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- debug_graph-overlay` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
