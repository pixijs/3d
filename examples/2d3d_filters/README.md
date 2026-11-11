# Filters

Pixi filters on a 3D view. A `View3D` is a pixi container, so pixi filters, masks and fades it like a sprite: the
scene draws into the view's rectangle, and pixi then works on that rectangle's finished pixels. The picture shows the
PixiJS logo blurred by a `BlurFilter` and cut to rounded corners by a `Graphics` mask, a card on a striped 2D panel the
filters never touch. pixi masks after it filters, so the cut stays sharp under the blur.

![The PixiJS logo on the light checker floor, blurred, inside a card with rounded corners on a lilac striped 2D panel; the pane on the right shows blur enabled at strength 2.0, colorMatrix off with alpha 1.00, mask enabled with radius 48, and fade off with alpha 0.35](reference.png)

## API

- `view3d.filters`: runs `BlurFilter`, `ColorMatrixFilter` and `AlphaFilter` from `pixi.js` over the view, each on the
  one before's output. A filter whose `enabled` is off is skipped, and with all three off pixi skips the filter pass
  and the view draws straight to the canvas. A filter left on at strength 0 still costs its passes.
- `BlurFilter` `strength` and `quality` (3, a pass each way fewer than pixi's 4); `ColorMatrixFilter` `desaturate()`,
  with the filter's `alpha` mixing the grey in; `AlphaFilter` `alpha`, which fades the view over the 2D behind it,
  since a `View3D` ignores its own `alpha`.
- `antialias: 'inherit'` and `resolution: 'inherit'` on each filter: a filter draws the view into a texture first, and
  these keep the canvas's antialiasing and pixel density there. pixi's defaults leave it jagged and soft.
- `view3d.mask`: clips the view to a rounded `Graphics` rectangle drawn over its size; `null` takes the mask off.
- `View3D` with `anchor: 0.5` and `setSize`: centres the view on its position and resizes its viewport rather than
  scaling it, so the 3D keeps its proportions at any size.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit.
- `Container`, `Sprite`, `TilingSprite`, `Texture` and `Rectangle` from `pixi.js`: the card and the striped panel,
  whose tile `Renderer` `generateTexture` draws once. `Application` from `pixi.js`.

## Controls

- Drag the card to orbit.
- Pane: a folder per effect, `blur`, `colorMatrix`, `mask` and `fade`, each with an `enabled` row and one value row:
  the blur's `strength`, the colour matrix's `alpha`, the mask's corner `radius` and the fade's `alpha`. A value row
  greys out while its effect is off.

## Files

- `index.ts`: the lesson. The filters, the mask and the card's layout.
- `controls.ts`: the pane's folders.
- `scene.ts`: the striped 2D panel round the view, and where the card fits, beside the pane or under it.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `ThemePane`, `LoadingScreen`,
`fitPortrait` and the palette's `mixColor`.

## See also

- [Stacking effects](../post_effect-stack/README.md): `@pixi/3d`'s own post effects, which run inside the view.
- [View in UI](../2d3d_view-in-ui/README.md): a view placed, sized and anchored in a 2D layout.
- [Glass over 2D](../2d3d_glass-over-2d/README.md): glass that bends the 2D behind its view, which a filter would stop.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- 2d3d_filters` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
