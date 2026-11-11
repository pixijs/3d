# Render graph

A view draws each frame by running a list of passes, its render graph, and you add steps to it in two ways.
`createDefaultGraph3D` builds the list: the shadow map, the sky and the opaque scene, the see-through scene, then a pass
that puts the frame on screen. A `Pass3D` in `passes` adds its own passes at a stage of that list, here a ring of
light at a set distance from the camera, and the `graph` option hands you the list itself, to append where no stage
reaches. The three insets are copies of the frame taken at three points in the list, so each shows only what the passes
before it drew.

![The pink PixiJS logo over a see-through purple plinth on the light checker floor, with a sky-blue ring of light crossing the floor behind it; three insets down the right show the middle of the frame copied at three points: afterOpaque has the logo, floor and shadows but no plinth, afterTransparent adds the plinth, and end of graph adds the ring; the pane shows the scan · Pass3D folder with enabled on, radius 14.8, width 1.00 and color 0x38bdf8, and graph builds 1](reference.png)

## API

- `View3D` with `composite: true`, `passes` and `graph`. Composite mode draws the scene into a texture,
  `graph.sceneColor`, then onto the screen, so a pass can read the frame so far. `passes` lists the `Pass3D`s built in
  at their stages; at one stage their order decides, so the `afterTransparent` copy runs before the scan and misses
  the ring. `graph(renderer, options)` is the builder the view calls on its first render and on every rebuild.
- `createDefaultGraph3D(renderer, options)`: the default list, as `{ graph }`. The builder forwards `options` as they
  come, since they carry the `globalTextureBindings`, `passes` and `composite`, then appends the end-of-graph copy.
- `Pass3D`, with `Pass3DOptions`, `PassContext` and `PassStage`: the base class of `ScanPass` and `FrameCapture`. A
  pass names its `stage` and adds render passes in `build(graph, ctx)`, which the view calls once per graph build, for
  enabled passes only. Flipping `enabled` rebuilds the graph; a uniform write doesn't.
- `FullscreenPass` with `label`, `fragment`, `uniforms`, `reads`, `writes` and `blendMode`: one fullscreen draw of an
  `EffectFragment`, a WGSL `gpu` and a GLSL `gl` body that each define `effect(uv)`. The scan reads `ctx.opaqueDepth`,
  measures each pixel's distance with `viewPos(uv)` and blends into `graph.sceneColor`. The copy reads
  `graph.sceneColor` with `sampleColor` and writes `graph.importColor(() => texture)`, a texture it owns.
- `RenderGraph`: the list itself, with `sceneColor`, `importColor` and `addPass`.
- `Mesh3D`: the plinth, blended clay, so it draws in the transparent pass, after both opaque copies are taken.
- `Vector3` `distanceTo`: the scan's first radius. `OrbitCamera` from `@pixi/3d/extras`.
- `UniformGroup` and `Color` from `pixi.js`: the scan's `uScanRadius`, `uScanWidth` and `uScanColor`, kept across
  rebuilds. `RenderTexture` holds each copy, which lands in it upright on both backends.
- `Application`, `WebGLRenderer` and `WebGPURenderer` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: the `scan · Pass3D` folder's `enabled` turns the scan off and on, which rebuilds the graph; `radius`, `width`
  and `color` are uniform writes that leave it as it is. `graph builds` counts the times the view called the builder.

## Files

- `index.ts`: the lesson. The view's `passes` and `graph` builder, the logo and plinth, and the pane.
- `ScanPass.ts`: `ScanPass`, a `Pass3D` at `'afterTransparent'`, with the ring's WGSL and GLSL in `SCAN_FRAGMENT`.
- `FrameCapture.ts`: `FrameCopy`, which owns a texture and makes the `FullscreenPass` that copies the middle of the
  frame into it (`COPY_FRAGMENT`), and `FrameCapture`, a `Pass3D` that adds one at its stage.
- `visuals.ts`: the three insets in run order, in a column at the right on a wide screen or a row along the bottom on a
  narrow one, and each copy sized to its inset.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `clayMaterial` and
`roundedCylinder` for the plinth, `InsetView` as a texture card per copy, `NARROW_BELOW`, `ThemePane`,
`LoadingScreen`, `fitPortrait`, and `BRAND`, `THEMES` and `themeFromUrl` from the palette.

## See also

- [Seeing the frame](../debug_graph-overlay/README.md): the graph's passes as they run, recorded and stepped through.
- [Custom effect](../post_custom-effect/README.md): a `PostEffect`, the kind of `Pass3D` that runs at the
  `'beforeToneMapping'` and `'afterToneMapping'` stages.
- [Scene outputs](../post_scene-outputs/README.md): textures the scene draw writes beside its colour, copied out each
  frame by an `ExtractPass`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_render-graph` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
