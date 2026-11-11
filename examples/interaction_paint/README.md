# Painting on a mesh

The hit under the pointer says where on a surface it touches: picked triangle by triangle, a mesh's `hit3D` carries
the `uv` there, 0 to 1 across and down its texture, and the surface's `normal`. Painting is then plain 2D: `uv` times
the canvas's size is a pixel, the canvas's 2D context draws there, and `CanvasSource.update()` sends the canvas to the
GPU, at most once a frame. The picture shows a white ball wearing its own uv grid, with one sky stroke across its
front that ends at the brush ring and the hit's normal; picked against its bounding box instead, the ball's hits carry
no uv, so nothing paints.

![A white clay ball on the light checker floor, ruled with a lilac uv grid, with a thick sky-blue stroke across its front that ends in a dark brush ring, a pink arrow standing out of the ring along the surface normal; the pane in the top right shows brush radius 16 px, colour 0x38bdf8, hitVolume geometry, a clear button, and a hit3D folder reading uv.x 0.60 and uv.y 0.42](reference.png)

## API

- `Mesh3D` with `hitVolume: 'geometry'`, `eventMode: 'static'` and `cursor: 'crosshair'`: the ball is picked by its
  triangles, so every hit carries a `uv` and a `normal`. With `hitVolume: 'box'` it's picked against its bounding
  box, whose hits have neither, and `triangleIndex` reads -1.
- `Pointer3DEvent` from `pointerdown`, `pointermove`, `pointerout`, `pointerup` and `pointerupoutside` on the ball:
  a press starts a stroke for its `pointerId`, a move paints to `e.hit3D.uv`, leaving the ball lifts the brush, and a
  release ends the stroke. `e.stopPropagation()` on the press keeps the `OrbitCamera` still while you paint.
- `hit3D` `point`, `localPoint`, `normal`, `uv` and `triangleIndex`: copied out into a hit of the example's own, since
  the event reuses its `hit3D` on the next dispatch.
- `createRaycastHit3D` and `RaycastHit3D`: that kept hit, which the brush ring, the arrow and the pane's `uv` rows read.
- `View3D` `raycast(position, out)`: the same hit without an event. The page opens with one, through the point on
  screen `worldToScreen` gives for a spot on the ball's front, and paints the opening stroke up to it.
- `CanvasSource` and `Texture` from `pixi.js`: the paint is a 1024 × 512 canvas the ball's material samples as its
  `baseColorTexture`. Drawing on its `context2D` changes nothing on screen until `update()` sends it again.
- `Box` and `Vector3`: the bounding box `'box'` picks, its struck face outlined, and the normal arrow's tip.
- `OrbitCamera` from `@pixi/3d/extras`: drag off the ball to orbit, damped, with no pan, staying above the floor.
- `Application`, `Point` and `Renderer` from `pixi.js`.

## Controls

- Drag on the ball to paint; the ring shows the brush's size and colour at the last hit, and the arrow its normal.
  Drag off the ball to orbit.
- Pane: `Brush radius` (6 to 48 canvas px) and `Colour` set the brush, `hitVolume` switches the ball between
  `geometry` and `box`, and `Clear` paints the primer back. The `hit3D` folder reads `uv.x` and `uv.y` of the last
  hit; a box hit reads 0, 0. On `box` the frame draws the bounding box and outlines the face the pointer struck.

## Files

- `index.ts`: the lesson. The paint canvas and its texture, the ball, its pointer listeners, the upload once a frame,
  the opening raycast and the pane.
- `brush.ts`: round strokes on the canvas's 2D context, pixel to pixel, with no 3D in it. A jump across the uv seam
  starts a new stroke rather than streaking across the picture.
- `scene.ts`: the primer, a uv grid and seam the ball wears under the paint, and the camera and orbit round the ball.
- `visuals.ts`: the brush ring laid on the hit, the normal arrow, and on `box` the bounding box and its struck face.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `createClayMaterial` with a
`baseColorTexture`, `clayGeometry('sphere')` and `CLAY_UV_LAYOUT` for the ball's uv size, `RingHelper`,
`ArrowHelper`, `BoxHelper`, the palette, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Stamp, fade, reuse](../interaction_decals/README.md): place a mesh at `hit3D.point` instead of painting a texture.
- [Hit volumes](../interaction_hit-volumes/README.md): the `hitVolume` choices and what each costs.
- [Raycast](../interaction_raycast/README.md): `View3D.raycast` from your own loop, with a reused hit.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- interaction_paint` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
