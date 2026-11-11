# Glass over 2D

3D glass bends the 2D pixi content drawn behind its view. A `Material3D` built with a `transmission` group draws after
everything opaque and samples a copy of what's on screen so far, 2D included, bent by its `ior` and `thickness`. The
picture shows the PixiJS logo in pale pink glass, turned 32°, over a 2D poster whose shapes shift off the triangle's
dashed outline, which is drawn after the view and so sits sharp on top. The glass sees the 2D because the 2D goes on
the stage first, the view has no background, and on WebGL the renderer keeps a back buffer to copy.

![The PixiJS logo in pale pink glass, turned 32°, over a 2D poster of grid paper with a purple circle, an orange triangle, a sky square and the headline Drawn in 2D, which shift and bend through the glass; a dashed outline of the triangle, tagged 2D after view3d, stays sharp on top, inside the view's dashed edge tagged view3d; the pane in the top right shows Glass copies webgpu · canvas, background off, Turned away 32°, ior 1.50, roughness 0.05 and a transmission folder with factor 1.00 and thickness 1.50](reference.png)

## API

- `Material3D` with its `transmission` group (`factor`, `thickness`), and its `ior`, `roughness` and `baseColor`: glass
  that bends what was drawn before it. Built with the group, `material.transmission` is its runtime object, whose
  values change without a rebuild. A face square to the camera shifts nothing; turned, it shifts what's behind it.
- `webgl: { useBackBuffer: true }` in `app.init`: WebGL can only copy a back buffer; WebGPU copies the canvas.
- `view3d.background = null`: with no background the view lets the 2D through; given the stage's sky, the glass bends
  the sky instead. No post effects or filters either: they draw the view into a texture of its own.
- `View3D` with `anchor: 0.5`, `setSize` and `position`: the view centred in the poster, with `view3d.fog = null`.
- `Quaternion` and `QuaternionData`: the drag turns the logo's `quaternion` with `premultiply` and `setFromAxisAngle`,
  like a ball rolled under the hand, and a flick coasts on. `Container3D` types the node it turns.
- `pointerdown`, `globalpointermove`, `pointerup` and `pointerupoutside` on the view, each a `FederatedPointerEvent`
  from `pixi.js`; the coast runs on the app's `Ticker` only while it moves.
- `Container`, `Graphics`, `Text`, `Point` and `Rectangle` from `pixi.js`: the poster, laid out round the view's
  centre. `Application`, `DEG_TO_RAD` and `RAD_TO_DEG` from `pixi.js`.

## Controls

- Drag inside the view's dashed outline to turn the logo any way round, and flick it to set it spinning until it slows
  to rest or you grab it.
- Pane: `Glass copies` says what the glass copies on this backend; `background` puts the stage's sky behind the logo;
  `Turned away` reads how far its front is turned from the camera; `Face the camera` turns it head-on, where its flat
  faces shift nothing; `ior` and `roughness` set the glass, and the `transmission` folder its `factor` and `thickness`.

## Files

- `index.ts`: the lesson. The back buffer, the draw order, the glass material and the pane.
- `scene.ts`: the 2D poster behind the view, and the layout that sizes the view inside it.
- `trackball.ts`: the drag that turns the logo, the coast after a flick, and the turned-away angle.
- `visuals.ts`: the view's dashed edge and tag, and the triangle's outline drawn after the view.

From the theme kit (`examples/shared/theme/README.md`): `loadPixiLogo` with `material: 'source'`, since the glass
replaces it; `ThemeStage` with its floor, fog and shadows off; `ScreenLines`, `LabelLayer`, `ThemePane`,
`LoadingScreen` and `fitPortrait`.

## See also

- [Glass and liquids](../materials_transmission/README.md): transmission over a 3D scene, with the rest of its settings.
- [Filters](../2d3d_filters/README.md): pixi effects over a view's finished pixels.
- [View in UI](../2d3d_view-in-ui/README.md): a view with no background inside a 2D layout.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- 2d3d_glass-over-2d` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
