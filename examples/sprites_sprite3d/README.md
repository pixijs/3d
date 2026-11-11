# Sprites in 3D

A `Sprite3D` is a picture on a flat quad, sized from its texture and turned toward the camera. One white PixiJS
wordmark texture makes three sprites in a row, seen from 45° above: a purple sign with `billboardMode: 'none'` that
stays turned the way it was placed, a pink cutout with `'cylindrical'` that turns about its up axis and stands on its
feet, and a sky marker with `'spherical'` that floats and faces the lens square-on. `billboardMode` is a `Mesh3D`
property, so the three clay cubes in front turn the same way as the mode the pane gives them; orbit and watch which
ones follow you.

![Three PixiJS wordmarks seen from above over the light checker floor: a purple one on the left turned away and tagged none, a pink one in the middle standing upright and squat from this height, tagged cylindrical, and a sky one on the right floating and facing the camera square-on, tagged spherical, each with an ink dot on its position; three small clay cubes, lilac, pale sky and pale pink, float in a row in front; the pane in the top right shows a cutout · Sprite3D folder with pixelSize 0.0040, width 3.07 and tint 0xe91e63, and a shapes · Mesh3D folder with billboardMode cylindrical](reference.png)

## API

- `Sprite3D` with `texture`, `pixelSize`, `anchor`, `tint` and `billboardMode`: `pixelSize` turns texture pixels into
  world units (0.004 makes the 767 px texture 3.07 wide), `anchor` picks the point of the image that sits on
  `position` (`{ x: 0.5, y: 1 }` is the bottom edge, since y runs down the image as on a 2D sprite), and `tint`
  colours the white. `width` reads back texture pixels times `pixelSize`.
- `BillboardMode`: `'none'` stays as placed (the sign's `angle` turns it 20°), `'cylindrical'` turns about the up axis,
  and `'spherical'`, `Sprite3D`'s default, also tips to face the lens. A spherical sprite keeps the centred default
  anchor, since an off-centre one would drift as the camera moves.
- `Mesh3D` `billboardMode`: on the clay cubes, `'cylindrical'` replaces their turn about the up axis and `'spherical'`
  their whole rotation, both keeping their scale; a mesh's default is `'none'`, where they spin at their own angles.
- Nothing casts here: a `Sprite3D` doesn't cast by default, and the cubes set `castShadow: false`, since the shadow
  pass doesn't turn billboards. `stage.key.castShadow = false` then skips the shadow pass.
- `Container3D` and `Vector3`: the cubes' parent, and the camera's up, which the visuals use to hang the spherical
  sprite's tag under its bottom edge.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit and the wheel to zoom, from 8 to 20 away.
- `Graphics`, `Rectangle`, `Renderer` (`generateTexture`) and `Texture` from `pixi.js`: the kit's wordmark drawn into
  a mipmapped texture with a clear border, so the artwork never touches the texture's edge. Any pixi `Texture` works,
  such as an image from `Assets.load`. Also `Application`.

## Controls

- Drag to orbit and use the wheel to zoom; watch which sprites and cubes turn to follow the camera.
- Pane: the `cutout · Sprite3D` folder sets the pink sprite's `pixelSize` and `tint` and reads its `width`; the
  `shapes · Mesh3D` folder sets the cubes' `billboardMode`.

## Files

- `index.ts`: the lesson. The three sprites, the cubes' `billboardMode`, and the pane.
- `scene.ts`: the white wordmark texture, and the three clay cubes with their spin and bob.
- `visuals.ts`: a dot on each sprite's `position` and a tag naming its `billboardMode`.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its fog pushed back, `wordmarkContext` and
`WORDMARK_SIZE`, `clayGeometry` and `clayMaterial` with the `ClayColor` type, `DotHelper`, `LabelLayer`, `ThemePane`,
`LoadingScreen` and `fitPortrait`, with `BRAND`, `THEMES` and `themeFromUrl`.

## See also

- [Fire and smoke](../particles_flipbook/README.md): particles with billboard modes of their own.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- sprites_sprite3d` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
