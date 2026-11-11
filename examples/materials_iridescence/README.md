# Iridescence

A thin film over a surface, whose colour shifts with the angle you see it from, like soap on a bubble or oil on a
puddle. The PixiJS logo wears a grey metal under the film and sweeps slowly about its upright: as a face turns away,
it shows the colour a thinner film shows straight on. The strip under it wears the same film read through a thickness
map, so it lays out every thickness from `thicknessMinimum` at its left end to `thicknessMaximum` at its right, a
legend to read the logo's colour against.

![The PixiJS logo turned well to one side over the light checker floor, its faces in a purple and blue film with teal edges; under it a flat strip runs from grey on the left through brown, slate blue, gold and magenta to teal on the right, tagged thicknessMinimum above its left end and thicknessMaximum below its right; the pane in the top right shows the iridescence folder with factor 1.00, ior 1.30, thicknessMinimum 0 and thicknessMaximum 400, and Turn ticked](reference.png)

## API

- `Material3D` with its `iridescence` group (`factor`, `ior`, `thicknessMinimum`, `thicknessMaximum`): passing the
  group at construction lays the film into the shader, and `material.iridescence` is then its runtime object, whose
  values change without a rebuild. `factor` blends the film in, `ior` is the film's index of refraction, and the two
  thicknesses, in nanometres, bound the film. With no map, the film is `thicknessMaximum` thick all over. `FILM` writes
  the engine's defaults out as `IridescenceOptions`, so you can see what the pane changes.
- `iridescence` `thicknessTexture`: the strip's ramp, whose green runs from 0 at the left to 1 at the right, spreading
  the film from `thicknessMinimum` to `thicknessMaximum` across it. Its red stays white, since the map shares a slot
  with the packed `texture`, whose red scales `factor`.
- `Material3D` `baseColor`, `metallic` and `roughness`: the mid-grey metal under the film, dark enough that the film's
  colour fills the reflection.
- `Mesh3D` and `PlaneGeometry`: the strip, with `castShadow: false` so the only shadow on the floor is the logo's.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`. `visuals.ts` keeps the end tags off the strip as its
  edges slope on screen, with `Vector3`, `Matrix4` and `worldToScreen`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held within about 20° of the strip's face, so it still reads as
  a legend.
- `Application`, `BufferImageSource`, `Texture` and `Point` from `pixi.js`: the app, and the 256-texel ramp built from
  bytes.

## Controls

- Drag to orbit.
- Pane: the `iridescence` folder sets `factor`, `ior`, `thicknessMinimum` and `thicknessMaximum` on the logo, and the
  strip copies them; `Turn` stops and starts the logo's sweep.

## Files

- `index.ts`: the lesson. The two films, the pane and the logo's sweep.
- `scene.ts`: the thickness ramp, the strip, and where the logo sits and how it sweeps.
- `visuals.ts`: the tags naming the strip's two ends.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, with
`form: false`; `loadPixiLogo` re-skinned with `setMaterial`; `mixColor`, `ThemePane`,
`LoadingScreen`, `LabelLayer` and `fitPortrait`.

## See also

- [Clearcoat](../materials_clearcoat/README.md) and [Sheen](../materials_sheen/README.md): the other layers a
  `Material3D` lays over its base.
- [Specular and IOR](../materials_specular-ior/README.md): `ior` on the base itself, and how strongly a non-metal
  reflects.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_iridescence` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
