# Scene outputs

The scene draw can write more than its colour. A `SceneOutput` is an extra texture that every opaque surface writes in
the same draw that shades it: `normalOutput` comes ready-made, and this example defines two of its own, each surface's
base colour and its distance from the camera. An `ExtractPass` makes the view write an output and copies it each frame
into a texture you keep, and three cards beside or under the lit view show the copies. The see-through sphere in the
middle is blended, so it shows in the lit view and in none of the cards: blended surfaces write only the colour.

![The pink PixiJS logo floating over an arc of five clay shapes on the light checker floor: a purple cube, an orange capsule, a see-through sky-blue sphere, a pale pink torus on its rim and a lilac pyramid; down the right under the pane, three cards show the middle of the frame as the normal output, the logo and shapes in normal colours over a flat green floor, the albedo output, the same in flat unlit colours over a checker floor that runs unfogged to the horizon, and the depth output, the logo light grey against black where the floor runs far behind it, and the shapes light grey over a floor that fades from light grey at the bottom to black; the sphere is missing from all three cards; the pane shows an ExtractPass folder with normal, albedo and depth ticked, see-through ticked and attachments 4](reference.png)

## API

- `SceneOutput`, `outputs.ts`'s albedo and depth: `name` is the field a shader writes as `outputs.<name>`, `format`
  is `'rgba8unorm'`, `bits: { opaque: bit }` hands the bit to every opaque surface on the engine's template (the clay
  and the logo's enamel among them), and `clearValue` is what a pixel no surface drew holds. Depth clears to black
  with alpha 1, so the sky reads as far; albedo keeps the default, transparent, as `normalOutput` does. So above the
  horizon the normal and albedo cards show their own panel through, white or near black with the theme, and the depth
  card shows black.
- `ShaderBit` with `outputs`, `interStage` and `gpu` / `gl` `vertex.end` and `fragment.end` code. The albedo bit
  writes the material slot's `albedo` with a `pow(1 / 2.2)` encode for display, before lights, shadows or fog touch
  it, so the albedo card shows the checker floor flat to the horizon. The depth bit carries view-space z from the
  vertex to the fragment and divides it by the camera's distance from the origin, where the subject stands, read from
  the engine's `camera.uCameraPosition`. It writes white at `DEPTH_NEAR` (half that distance) and black at
  `DEPTH_FAR` (twice it), so the subject reads the same grey at any zoom and on a phone, where the camera backs off.
- `normalOutput` from `@pixi/3d/extras`: each surface's normal in the camera's space, packed into 0 to 1, so the
  floor is one flat green and the logo's sway and the shapes' slow rock shift the colours.
- `ExtractPass` from `@pixi/3d/extras`, with `output`, in `View3D`'s `passes`. It lists its output in
  `requiredOutputs`, and the view writes an output only while an enabled pass lists it, so turning a pass's `enabled`
  off stops the write and rebuilds the render graph once. `texture` is the copy, the view's size, rewritten every frame
  and kept until the pass's `destroy()`; the view never destroys a pass.
- `FxaaEffect` last in `passes`, enabled only on WebGL while an output is written (`RendererType` tells the
  renderers apart). There an `rgba8unorm` output makes the scene draw one sample a pixel, and FXAA smooths the edges
  that leaves. WebGPU keeps the canvas's four samples.
- `Mesh3D` and `Container3D`: the clay shapes. Swapping the sphere's `material` for blended clay moves it into the
  transparent pass, which writes no outputs.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held above the floor and in front of the logo.
- `Texture` and `Rectangle` from `pixi.js`: each card shows a `Texture` whose `frame` is the middle of the pass's
  `texture.source`, refit when the copy resizes. `Texture.EMPTY` clears a card whose pass is off, since the copy keeps
  the last frame it took. `Application` and `Point` from `pixi.js`.

Cost: nothing draws twice, but each output is one more colour attachment on the scene draw. WebGPU allows 8, and 32
bytes a pixel across the colour and every output; WebGL guarantees at least 4. The colour and these three
`rgba8unorm` outputs, 8 bytes each, fill WebGPU's 32 bytes exactly, so a fifth like them throws there.

## Controls

- Drag to orbit.
- Pane: the `ExtractPass` folder's `normal`, `albedo` and `depth` rows are each pass's `enabled`; off, the view stops
  writing that output and its card reads `not written`. `see-through` swaps the sphere between opaque and blended clay.
  `attachments` counts the scene draw's colour attachments, the colour plus each output, 1 to 4.
- URL flags: `?theme=light|dark`, `?renderer=webgl|webgpu`.

## Files

- `index.ts`: the lesson. The three `ExtractPass`es and FXAA in `passes`, the logo and its sway, the sphere's swap
  to see-through clay, the pane.
- `outputs.ts`: the albedo and depth `SceneOutput`s and the `ShaderBit`s that write them.
- `scene.ts`: the five clay shapes in an arc, rocking slowly; it hands back the sphere in the middle.
- `visuals.ts`: the three cards, the crop each shows, the `not written` tags, and the column or row they sit in: down
  the right on a wide screen, along the bottom on a squarer one or a phone.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `clayMaterial` and
`clayGeometry`, `InsetView` as a texture card per output, `LabelLayer` for the `not written` tags, `NARROW_BELOW`,
`ThemePane`, `LoadingScreen`, `fitPortrait`, and `THEMES` and `themeFromUrl` from the palette.

## See also

- [Render graph](../post_render-graph/README.md): copies of the frame's colour at three points in the graph, and
  `Pass3D`s of your own.
- [Ambient occlusion](../post_ssao/README.md): `SsaoEffect`, an effect that can read `normalOutput` in the same frame.
- [Anti-aliasing](../post_antialiasing/README.md): MSAA, `FxaaEffect`, and the scene output that turns MSAA off on
  WebGL.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_scene-outputs` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
