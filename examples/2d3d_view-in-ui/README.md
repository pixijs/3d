# View in UI

A `View3D` is a pixi container: it sits in a 2D layout, lets the 2D show through, and shares pointer input with the
pixi UI round it. It goes into a product card with `addChild`, and `position`, `width`, `height` and `anchor` place and
size its viewport in the card's pixels. The picture shows the view's dashed rectangle, a dot on the point `position`
names, and pink hatching over the part that takes pointer events: with `hitArea` set to an ellipse round the logo, a
tap outside it reaches the colour swatches under the view.

![A white product card titled PixiJS logo, with a line asking the reader to drag the logo and tap a colour, and the pink PixiJS logo inside the view's dashed rectangle; a dot tagged position marks its top-left corner, pink hatching fills an ellipse round the logo, and four colour swatches sit under it, the pink one ticked; the pane in the top right shows Pointer hitArea = logoArea, background null, and a Layout folder with position.x 20, position.y 96, width 400, height 400 and anchor.x 0.00](reference.png)

## API

- `View3D` with `width`, `height`, `anchor`, `position` and `cursor`: a viewport in pixels, so the picture never
  stretches; `anchor` picks which point of the rectangle `position` names. `composite: false`, the default, draws the
  scene straight onto the canvas; `true` draws it into a texture first, which costs a texture and one more draw. It's
  fixed once built.
- `view3d.background = null`: the card shows through wherever the logo isn't.
- `view3d.hitArea` set to an `Ellipse` from `pixi.js`, in the view's own pixels from its anchor point: outside the
  shape the view isn't hit at all, so a tap reaches what's behind. With `null`, its whole rectangle takes every
  pointer event, empty space included.
- `view3d.eventMode = 'none'`: takes the view out of pixi's hit test, and the orbit and any 3D picking with it.
- `addChild` order: adding a child again moves it to the front, so swatches added after the view take taps first.
- `OrbitCamera` from `@pixi/3d/extras`: drag the logo to turn it, held to a tilt by `minPolarAngle` and
  `maxPolarAngle`, with zoom and pan off. It listens on the view, so whatever keeps events from the view stops it too.
- `Container`, `Graphics`, `Sprite`, `Texture`, `Text`, `Rectangle`, `Matrix`, `Point` and `Application` from
  `pixi.js`: the card, its swatches, whose `pointertap` repaints the logo, and the frame's marks.

## Controls

- Drag the logo to turn it; tap a colour to repaint it.
- Pane: `Pointer` picks how the view takes pointer events, `hitArea = null`, `hitArea = logoArea`, `eventMode = 'none'`
  or `swatches above` (tap a swatch after each); `background` sets the view's to `null` or `0x9adcfb`; the `Layout`
  folder moves and sizes the view with `position.x`, `position.y`, `width`, `height` and `anchor.x`.

## Files

- `index.ts`: the lesson. The view in the card, its hit area and pointer modes, and the swatches repainting the logo.
- `scene.ts`: the product card in plain pixi, with its title, line and swatches, and its fit on the screen.
- `controls.ts`: the pane's rows.
- `visuals.ts`: the view's dashed rectangle and the dot on the point `position` names.
- `hitRegion.ts`: the hatching over the part of the view that takes pointer events.

From the theme kit (`examples/shared/theme/README.md`): `EnamelMaterial`, one material on every piece of the logo, so
a swatch's single `baseColor` write repaints it; `loadPixiLogo`, `ThemeStage` with its spotlight, `ScreenLines`,
`LabelLayer`, `ThemePane` and `LoadingScreen`.

## See also

- [Filters](../2d3d_filters/README.md): pixi filters and masks on a view.
- [Many views](../2d3d_many-views/README.md): many views on one stage, each placed and sized like this one.
- [Pointer events](../interaction_pointer-events/README.md): events on the meshes inside a view.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- 2d3d_view-in-ui` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
