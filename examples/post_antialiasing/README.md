# Anti-aliasing

A pixel holds one colour, so an edge that crosses part of it comes out as a stair step, and a wire thinner than a
pixel breaks into dashes. The canvas's `antialias` option gives it MSAA, four samples a pixel, and the scene keeps them
through post effects: a view with an effect on draws its scene into a texture first, and that texture takes the
canvas's samples too. One case still drops them: a scene output the GPU can't average, such as SSAO's scene normals on
WebGL. `FxaaEffect`, last in `passes`, is for a canvas without MSAA or a view in that case. It smooths the finished
picture, but it can't join up a wire the pixels already lost. A clay fence runs into the haze, and a loupe shows the
canvas's own pixels at the marked patch of rail and wire.

![A purple clay fence of thin posts, with a rail and a hair-thin pink wire, runs from the near left into the haze over the light checker floor; a tag names the wire, a small box marks a patch between two far posts, and the loupe in the bottom right, titled 1 square = 1 pixel, magnifies it into squares where the rail's edges blend in soft steps and the wire is a faint broken line; the pane shows antialias ticked, effect.enabled, ssao.enabled and fxaa.enabled unticked, In use MSAA and Wire width 0.4 px](reference.png)

## API

- `antialias` in `Application.init()` from `pixi.js`: MSAA for the canvas. pixi asks for it when it creates the
  context, so it can't change on a live canvas, and the pane's row reloads the page. pixi's default is `false`. The
  pane reads it back from `renderer.view.antialias`.
- `TintEffect` from `@pixi/3d/extras`, white: stands in for any post effect. It changes no pixel, so the loupe shows
  only what drawing the scene into a texture does, and with MSAA that's nothing.
- `SsaoEffect` from `@pixi/3d/extras` with `sceneNormals: true`: the scene draw writes its normals beside its colour,
  and every texture a draw writes shares one sample count. pixi can't multisample the normals' format on WebGL, so
  there the scene draws one sample a pixel while it's on. WebGPU multisamples the normals too. Its shading barely shows
  on the thin fence; it's here for what it does to MSAA.
- `FxaaEffect` from `@pixi/3d/extras`, last in `passes`: smooths edges in the finished picture, five to nine reads a
  pixel. `edgeThreshold` (0.125) is the smallest contrast that counts as an edge, `edgeThresholdMin` (0.05) the floor
  for dark areas, and `edgeSharpness` (8 sharpest, 4, 2 softest) how far the blend reaches along an edge.
- `enabled` on each effect: a disabled one stays in `passes` and is skipped. A flip rebuilds the render graph once.
- `View3D` with `passes`, its `camera`, and `worldToScreen()`, which aims the loupe and measures the wire on screen.
- `Container3D`, `Mesh3D` and `Vector3`: the fence. The rail and wire turn onto it with
  `quaternion.setFromUnitVectors()` and skip `castShadow`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held to angles that keep the loupe's patch on the fence.
- `RendererType` from `pixi.js`: the `In use` row checks for WebGL, where SSAO's normals turn MSAA off.
- The loupe, from `pixi.js`: a `RenderContainer` copies the patch once everything else has drawn, into a
  `RenderTexture` with `copyToTexture()` on WebGPU, or through a `CanvasSource` on WebGL, which can't copy an opaque
  canvas. A `Sprite` of that `Texture` shows it with `scaleMode: 'nearest'`; `Rectangle`, `Point` and `Renderer` are
  its patch, a screen point and the copy's type.

## Controls

- Drag to orbit; the patch moves back onto the fence a second after a drag ends.
- Pane: untick `antialias` and the page reloads with a one-sample canvas, and the loupe's edges step; tick
  `fxaa.enabled` and they smooth again, but the wire stays broken. Tick `effect.enabled` and the loupe doesn't change,
  since the scene keeps MSAA through the effect. Tick `ssao.enabled` and the loupe's edges step on WebGL and stay smooth
  on WebGPU. `In use` reads out MSAA, FXAA, both or none, and `Wire width` the wire at the loupe in canvas pixels. The
  `fxaa` folder sets `edgeThreshold`, `edgeThresholdMin` and `edgeSharpness`.
- URL flags: `?antialias=on|off`, `?effect=on|off`, `?ssao=on|off`, `?fxaa=on|off`, `?theme=light|dark`,
  `?renderer=webgl|webgpu`.

## Files

- `index.ts`: the lesson. The canvas's `antialias`, the three effects in `passes`, and the anti-aliasing they leave.
- `scene.ts`: the clay fence, whose rail and wire run from several pixels wide to under one.
- `controls.ts`: the pane, and the reload `antialias` needs.
- `visuals.ts`: the wire's tag, the patch's marker, and the wire's measured width.
- `PixelLoupe.ts`: the loupe, the finished canvas's own pixels magnified with no smoothing.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its fog pushed out, `clayMaterial` in a
`ClayColor`, `roundedCylinder`, `LabelLayer`, `ScreenLines`, `Panel` and `PanelOptions` (the loupe extends it),
`ThemePane`, `LoadingScreen`, `THEMES`, `themeFromUrl` and `fitPortrait`.

## See also

- [Stacking effects](../post_effect-stack/README.md): several effects in `passes`, and `enabled` on each.
- [Ambient occlusion](../post_ssao/README.md): `SsaoEffect` as the lesson, on a scene that keeps its MSAA.
- [Tilt shift](../post_tilt-shift/README.md): `FxaaEffect` last after a real effect, on top of the canvas's MSAA.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_antialiasing` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
