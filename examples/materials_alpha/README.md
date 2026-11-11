# Transparency

How a material's `alphaMode` treats a pixel's alpha, and `doubleSided` for cards seen from behind. Two cards wear the
PixiJS wordmark, whose shape lives only in its texture's alpha: 1 on the letters, 0 round them. The pane switches both
between `'opaque'`, the whole card with the clear part black, `'mask'`, a hard-edged cut-out, and `'blend'`, which
fades each pixel over what's behind it. A sky-blue glass logo floats behind them, blended, its foot behind both cards'
JS badges: on `'blend'` the faded badges draw over the glass from the front, and from behind the glass draws over them,
since blended meshes draw back to front.

![Two flat cards float over the light checker floor, each in a thin dark outline, wearing the pink PixiJS wordmark with the card round it cut away; the left is tagged front face, the right back face with its wordmark mirrored, and a pale sky-blue glass logo floats behind and between them, its foot hidden behind the two cards' solid pink JS badges; the pane in the top right shows the cardMaterial folder with alphaMode mask, alphaCutoff 0.50, alpha 0.60 and doubleSided ticked, and the glassMaterial folder with alpha 0.45](reference.png)

## API

- `Material3D` `alphaMode`: `'opaque'` (the default) ignores alpha and draws the whole card, black where the texture is
  clear; `'mask'` keeps each pixel whose alpha reaches `alphaCutoff` and discards the rest, drawn with the opaque
  meshes, so it writes depth, hides what's behind it and needs no sorting; `'blend'` mixes each pixel over what's
  behind it, after the opaque meshes, writing no depth and casting no shadow. The glass logo is `'blend'` at `alpha`
  0.45 with a glossy `roughness` of 0.15.
- Blended meshes draw back to front, sorted each frame by the distance from the camera to each mesh's origin, not by
  child order. The logo joins the scene after the cards, yet from the front it draws first and the blended cards' JS
  badges fade over its foot; from behind the order flips and the logo draws over their letters. Each mesh sorts as a
  whole, so a large blended mesh, or two that pass through each other, can draw in the wrong order where they overlap.
  A mesh's own triangles aren't sorted either: they draw in the order they're stored, so seen from the side the glass
  logo's far walls can draw over its near ones.
- `Material3D` `alpha`, `alphaCutoff` and `baseColorTexture`: a pixel's alpha is the wordmark texture's times
  `alpha`, and under `'mask'` that product is what the cutoff tests. The cards open at `alpha` 0.6 and `alphaCutoff`
  0.5, so `'mask'` draws the letters solid, an `alpha` under 0.5 or a cutoff over 0.6 drops them all at once, and
  `'blend'` fades them.
- `Material3D` `emissive`: the cards glow faintly from their own wordmark texture (`strength` 0.35), which keeps the
  letters bright on the dark theme and on a face turned from the light. The texture is clear round the letters, so
  the card there glows nothing and `'opaque'` still draws it black.
- `Material3D` `doubleSided`: draws each card's back face too, lit as if it faced the other way, so the right card
  shows its wordmark mirrored. It's fixed once a material is built, so the pane's toggle builds a new `Material3D`,
  gives it to both cards and calls `destroy()` on the old one; the other three are setters.
- `Mesh3D` and `PlaneGeometry` (`flipV`): the two cards, sharing one geometry and one material. They're built with
  `castShadow: false`, as the materials guide advises for masked cards: the shadow pass doesn't read `alphaMode` or
  `doubleSided` yet, so a masked card would cast a solid rectangle and a card whose back faces the light none.
  `scene.ts` types them with `BaseMaterial3D` and `Container3D`, and `CardOptions` picks the four options out of
  `BaseMaterial3DOptions`.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`, whose position `visuals.ts` takes into each card's
  space with `toLocal` and a `Vector3` to tell which face it sees.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with no azimuth limit, so you can walk behind the cards.
- `Application`, `Graphics`, `Rectangle`, `Renderer` and `Texture` from `pixi.js`: `renderer.generateTexture` draws
  the wordmark into a `Texture`, with `autoGenerateMipmaps` so its edges don't shimmer when a card draws small.

## Controls

- Drag to orbit, and walk round behind the cards to see their face tags swap and the glass logo come in front of
  them.
- Pane: the `cardMaterial` folder sets `alphaMode` (`opaque`, `mask` or `blend`), `alphaCutoff` (greyed out unless
  `mask`), `alpha` (greyed out under `opaque`) and `doubleSided`; the `glassMaterial` folder sets the glass logo's
  `alpha`.

## Files

- `index.ts`: the lesson. The card and glass materials, the pane, and how each row reaches the cards' material.
- `scene.ts`: the wordmark texture, the two cards, where the cards and the logo float, the logo's width, and their
  sway.
- `visuals.ts`: the outline round each card and the tag naming the face it shows the camera, hidden while the camera
  sees the card more than 60 degrees off face-on.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`; `loadPixiLogo`, re-skinned in glass with
`setMaterial`; `brandWordmarkContext` and `WORDMARK_SIZE` for the texture; `PathHelper` for the outlines; `ThemePane`,
`LoadingScreen`, `LabelLayer` and `fitPortrait`.

## See also

- [Render state](../materials_render-state/README.md): a material's `state`, its `blendMode`, `depthTest` and
  `cullMode`, set by hand.
- [Glass and liquids](../materials_transmission/README.md): glass that bends the scene behind it with `transmission`
  instead of blending over it.
- [Sprites in 3D](../sprites_sprite3d/README.md): the same wordmark as `Sprite3D` cut-outs that turn toward the
  camera.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_alpha` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
