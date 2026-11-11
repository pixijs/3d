# PBR, Phong and flat

A material decides how a surface answers light. Three PixiJS logos, each over a ball, wear `Material3D` (PBR),
`PhongMaterial` (Blinn-Phong) and `FlatMaterial` (unlit) in one shared pink: the PBR ball mirrors the sky near its rim,
the Phong ball has the same kind of highlight with no reflection, and the unlit one draws as a flat disc. All three take
the same `baseColor` and go on a mesh the same way, so switching models is a one-line change, and each step down costs
fewer texture reads a pixel: six, then two, then one.

![Three pink PixiJS logos in a row over the light checker floor, each over a ball, tagged PBR, Blinn-Phong and unlit; arrows tagged key light slant down from the upper left, a tag points at the environment reflection near the PBR ball's rim, and the unlit logo and ball are flat pink with no shading; the pane in the top right shows baseColor 0xed145b, shininess 128 and Light angle -40](reference.png)

## API

- `Material3D` with `baseColor` and `roughness`: physically based. Each light adds diffuse shading and a GGX highlight,
  and the view's environment adds fill and a reflection of the surroundings.
- `PhongMaterial` with `shininess` and `specularColor`: Blinn-Phong. The same diffuse and a highlight that `shininess`
  sizes and `specularColor` tints, here 0x383838, the 4% a `Material3D` non-metal reflects; the environment only fills.
- `FlatMaterial`: unlit. It draws its `baseColor` as it is, and neither the lights nor the environment reach it.
- `material.baseColor`: the pane writes one colour to all three at runtime.
- `SphereGeometry` and `Mesh3D` with `receiveShadow: false`: the three balls share one geometry. Nothing shadows them,
  and a lit material that receives shadows reads the shadow map nine more times a pixel.
- `Spherical` with `position.setFromSpherical()`, and `DEG_TO_RAD` from `pixi.js`: turn the stage's key light round
  the scene, and `lookAt` aims it back at the centre; only the way a directional light faces counts.
- `Container3D` and `PointData3D`: each column holds a logo and its ball, placed by the layout.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`. `Quaternion` and `Vector3`: the visuals' maths, a
  quarter turn for the light's rays and the point on the PBR ball's rim that the reflection tag points at.
- `OrbitCamera` and `OrbitCameraOptions` from `@pixi/3d/extras`: drag to orbit, with limits for each layout.
- `Application` and `PointData` from `pixi.js`, the second for a tag's offset in pixels.

## Controls

- Drag to orbit, far enough round to watch the PBR ball's reflection slide over it.
- Pane: `baseColor` sets the colour all three share; `shininess` sizes Phong's highlight, from 16 to 256; `Light angle`
  turns the key light from -40° to 40°, which the two lit columns answer and the flat one ignores.

## Files

- `index.ts`: the lesson. The three materials, the logos and balls, the key light's aim and the pane.
- `scene.ts`: the three layouts (a row, side-by-side pairs on a short screen, a stack on a portrait one) and
  `createColumn()`, which stands a logo and its ball in a column.
- `visuals.ts`: the model tags, the key light's rays and the environment reflection tag.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, so PBR has a world to
reflect, with no form light; `loadPixiLogo` with `material: 'source'` and `PixiLogo`'s `setMaterial`; `LightHelper`
for the key light's rays, `ThemePane`, `LoadingScreen`, `LabelLayer` and `fitPortrait`.

## See also

- [Metal and roughness](../materials_pbr/README.md): what `Material3D`'s `metallic` and `roughness` do.
- [Toon shading](../materials_toon/README.md): `ToonMaterial`, a banded lighting model with an outline.
- [Custom lighting model](../shaders_lighting-model/README.md): a lighting model of your own, from `createLightingBit`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_lighting-models` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
