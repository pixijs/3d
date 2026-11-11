# Container texture

A live 2D pixi scene on a 3D surface. `ContainerTexture` captures a `Container` into a texture any material samples,
here a `FlatMaterial` on the screen of a clay monitor that swivels slowly over the floor. The texture holds whatever
`render()` last captured, so you choose when it runs: every frame for animation, or only when your own dirty flag says
the picture changed. The picture shows its first half second, with the PixiJS wordmark near the screen's left edge over
a clock strip at 00:00.

![A lilac clay monitor floating over the light checker floor, its dark screen showing the pink PixiJS wordmark at the left over a strip with the clock at 00:00; the pane in the top right shows Render Every frame, resolution 1, Texels 512 × 320 and Captures / s 0, since no second has closed yet](reference.png)

## API

- `ContainerTexture` with `container`, `renderer`, `width`, `height` and `resolution`: captures the container's window
  from (0, 0) to (`width`, `height`) in its own pixels, at `resolution` texels a pixel. The container leaves its parent
  to live in the texture. With the renderer kept, it captures once at construction, and `render()` needs no argument.
- `render()`: every tick on `Every frame`, or only on the tick the clock's text changes on `On change`. Before the
  scene draws, so the screen shows this tick's picture; `autoUpdate: true` would capture from `Ticker.shared`, which
  this app doesn't render from.
- `source.resize(width, height, resolution)`: the same layout in more or fewer texels; the resize drops the old picture,
  so the next tick captures again. `source.pixelWidth` and `source.pixelHeight` read the size back.
- `FlatMaterial` with `baseColorTexture` and `fog: false`: shows the texture as pixi drew it, untouched by lights, tone
  mapping and haze, a powered screen. The texture is stored upright for a plane's default UVs, so it needs no flip.
- `View3D` and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held round the front by `minAzimuthAngle` and `maxAzimuthAngle`.
- `Container`, `Graphics` and `Text` from `pixi.js`: the 2D UI, drawn in its own pixels from (0, 0), with a backdrop
  that fills the texels nothing else covers; `Size` types its size. `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `Render` picks `Every frame` or `On change`. On change, only the clock's turn of the second captures, so the
  screen's wordmark lags the container's, outlined in pink where it is now, and catches up once a second.
  `resolution` picks 0.25, 0.5, 1 or 2 texels per UI pixel; `Texels` reads the texture's size, and `Captures / s` the
  captures in the last whole second.

## Files

- `index.ts`: the lesson. The texture, the screen's material, the dirty flag and the pane.
- `scene.ts`: the 2D UI in plain pixi: the bouncing wordmark, the clock and its strip.
- `visuals.ts`: the outline round the wordmark's place in the container, shown on `On change`.

From the theme kit (`examples/shared/theme/README.md`): `createMonitor`, the clay monitor whose screen shows the
texture; `brandWordmarkContext`, `PathHelper`, `ThemeStage`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Second cameras](../cameras_render-to-texture/README.md): a texture a 3D camera fills, in place of a 2D container.
- [Video texture](../materials_video/README.md): another live texture on a material.
- [View in UI](../2d3d_view-in-ui/README.md): the other way round, a 3D view inside a 2D layout.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- 2d3d_container-texture` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
