# UV transform

Moving a texture across a surface with a material's UV transform: scrolling, tiling and atlas frames.
`material.uvTransform` is a pixi `Matrix` that remaps the mesh's UVs before any texture is read, like a window onto the
texture: `scale(4, 1)` makes the window four pictures wide, and a `translate` written each tick slides it. A clay
conveyor belt shows four copies of a chevron tile scrolling left between its `u 0` and `u 1` ends, and the screen above
it plays a bouncing ball, because a spritesheet frame given as the base colour texture sets the transform by itself.

![A clay conveyor belt over the light checker floor, its white face showing four purple left-pointing chevrons parted by pale sky seams, between tags u 0 and u 1 at its ends; above it a lilac-framed screen on a purple neck shows atlas frame 3, a sky ball partway down to a purple floor line on night; the pane in the top right shows Scroll speed 0.40, Tiling 4.00, Frame rate 8 and Whole atlas off](reference.png)

## API

- `Material3D` `uvTransform`: the belt's `Matrix`, rebuilt each tick as
  `uv.identity().scale(settings.tiling, 1).translate(scroll, 0)`. The translate comes after the scale, so it counts
  copies of the texture; a growing offset reads further along it, so the picture slides the other way. The material
  copies the matrix, so one scratch `Matrix` serves every tick.
- `Texture.from` with `addressMode: 'repeat'`: tiling reads past u = 1, and the default clamps there.
  `autoGenerateMipmaps` keeps the stripes clean at a distance.
- `Spritesheet` (`parseSync`, `animations`) from `SpritesheetData`: cuts the atlas into eight frames. A frame as
  `baseColorTexture` sets the material's UV transform from the frame, so writing the next frame to
  `material.textures.baseColor` plays the flipbook; a `uvTransform` you set would win over the frame. The unframed
  atlas sets the identity, so the whole sheet fills the screen.
- `FlatMaterial` with `fog: false`: the screen shows its frame as drawn, unlit.
- `PlaneGeometry` with `flipV: true`: puts v = 0 on the top edge, so pictures stored top row first stand upright.
- `Mesh3D` and `Container3D`: the belt's face and the screen, each mounted in its clay prop.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept in front, since the belt's face and the screen are
  one-sided.
- `Application`, `Matrix`, `Spritesheet`, `Texture` and the `SpritesheetData` type from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `Scroll speed` sets the copies the belt's picture moves a second, backwards below 0; `Tiling` sets the copies
  across the belt; `Frame rate` sets the screen's frames a second; `Whole atlas` shows the unframed atlas in place of
  one frame, and greys `Frame rate` out.

## Files

- `index.ts`: the lesson. The belt's material and its transform each tick, the atlas, the screen's frames, and the
  pane.
- `scene.ts`: the stripe tile and the bounce atlas with its spritesheet data, drawn with the canvas 2D API since the
  example ships no image, and the clay belt and monitor that hold the two faces.
- `visuals.ts`: the `u 0` and `u 1` tags at the belt's ends.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `LabelLayer`,
`fitPortrait`, `clayMaterial`, `roundedBox` and `roundedCylinder`, and `BRAND`, `CLAY`, `cssColor`, `THEMES` and
`themeFromUrl` from the palette.

## See also

- [Fire and smoke](../particles_flipbook/README.md): frames cut from one sheet, played on particles.
- [PBR texture set](../materials_textures/README.md): the texture slots a UV transform moves.
- [Video texture](../materials_video/README.md): a moving picture from a clip instead of an atlas.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_uv-transform` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
