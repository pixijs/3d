# Custom tone mapping

Owning the whole output transform: `toneMapping: 'custom'` leaves out the engine's curve and display encode, so
materials write raw linear light into an `rgba16float` scene colour that keeps values above 1. `DisplayEffect` then
rolls that light off with Reinhard and encodes it for the screen. The split runs the same effect twice: on the left
with the curve off, so the glow and the lit floor clip flat, and on the right whole, so they roll off and keep their
shading. A float target is what gives your curve light above 1 to work with.

![A split screen of the glowing pink PixiJS logo on the light stage at exposure 2: the left half, labelled no curve, runs the effect without Reinhard, so the sky and floor clip to plain white and the logo to flat bright pink; the right half, labelled Reinhard, keeps a grey sky and checker floor and a deeper pink logo with its shading; the pane in the top right shows encode on and exposure 2.00](reference.png)

## API

- `View3D` `toneMapping = 'custom'`: set after `ThemeStage`, which sets `'none'`. Materials skip the curve and the
  encode and write raw linear light; `exposure` (2 here) still scales it first.
- `View3D` `graph` option: a function of the renderer and `DefaultGraph3DOptions` that returns the view's
  `RenderGraph`. `createDisplayGraph()` builds a bare one with the options' `globalTextureBindings`, `defaultColor`
  and `defaultDepth` on the view's own target, and `sceneColor: { format: 'rgba16float' }`, since an 8-bit target
  would clip above 1 before the curve. It adds a `BackgroundPass` for the sky and a `ForwardRenderPass` with
  `name: 'opaque'` and `sort: 'key'`, then calls the effect's `build()` with `input: graph.sceneColor` and
  `output: null`, so it draws to the screen, and ends with `graph.compile()`.
- `PostEffect`: the engine class `DisplayEffect` extends; it isn't in `view3d.passes`, since the graph builder calls
  its `build()` itself. `DisplayEffect.ts` holds the shader, an `EffectFragment` in WGSL and GLSL: it reads the frame
  with `sampleColor(uv)`, un-premultiplies, applies Reinhard `x / (1 + x)` when `reinhard` is on and the encode
  `pow(x, 1 / 2.2)` when `encode` is on, and premultiplies again. Both switches are lanes of one `uOutput` vec4 in a
  `UniformGroup`, written with `writeLane()`, so flipping one never rebuilds the graph.
- Two `View3D` objects: a graph and a mesh each belong to one view, so each half is a whole view with its own graph,
  effect, stage and logo. The first draws only into its half through `camera.viewport`; the second sits over the
  other half with `eventMode = 'none'`, sized with `setSize()`, and copies the first camera's `position`,
  `quaternion` and `fov` every tick.
- `Material3D` with `baseColor`, `metallic`, `roughness` and an `emissive` group (`color`, `strength` 0.8): the glow
  that lifts the logo past 1, shared by both halves.
- `OrbitCamera` from `@pixi/3d/extras`, with `autoUpdate: false`, so the tick moves it before the split copies the
  camera. `Application`, `UniformGroup`, `WebGLRenderer` and `WebGPURenderer` from `pixi.js`; the labels are pixi 2D
  on `app.stage`, outside both graphs, so no curve or encode touches them.

## Controls

- Drag on either half to orbit both.
- Pane: `encode` and `exposure`, bound to the right half; the left half copies each change.

## Files

- `index.ts`: the lesson. The float graph, the two `DisplayEffect` objects and the shared glowing material.
- `DisplayEffect.ts`: the effect and its shader, with its `reinhard` and `encode` switches.
- `split.ts`: the two views side by side, stacked on a portrait screen, the line between them, and the camera, theme
  and fog the second copies from the first.
- `visuals.ts`: the "no curve" and "Reinhard" labels under the logos.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo` and its `PixiLogo`, `BRAND`,
`THEMES` and `themeFromUrl`, `ThemePane`, `LoadingScreen`, `LabelLayer`, `ScreenLines` for the divider, and
`fitPortrait`.

## See also

- [Tone mapping](../lighting_tone-mapping/README.md): the engine's own curves under `toneMapping`, and `exposure`.
- [Custom effect](../post_custom-effect/README.md): a post effect in `view3d.passes`, single-pass and multi-pass.
- [Render graph](../post_render-graph/README.md): the default graph's passes, and adding to it through `graph`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_custom-tone-mapping` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
