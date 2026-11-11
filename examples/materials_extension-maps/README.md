# PBR extension maps

Texture maps vary a PBR extension across a surface, where its plain values set it for the whole material. Two spheres
share a geometry and the same `Material3D` options, and the right one also passes the extension's textures, so the
left one is pink glass all over while the right one turns to opaque white in every other stripe. Most channels scale
the plain value they belong to; anisotropy's red and green set a direction instead, and alpha in these maps is data
for the extension, not surface transparency.

![Two spheres in front of a row of pink and white clay slabs on the light checker floor, tagged plain values and texture maps: the left is pink glass all over, bending the slabs behind it, and the right has stripes of the same glass between stripes of opaque white; the pane in the top right shows Extension Transmission with Maps and Turn spheres on](reference.png)

## API

- `Material3D` and `Material3DOptions`: each extension gets a pair, a plain material and a mapped one that copies its
  options and adds only the textures. Setting `mesh.material` swaps the pair the spheres wear.
- `transmission` group: `texture`'s red scales `factor`, so stripes go from glass to opaque, and `thicknessTexture`'s
  green scales `thickness`, which grows toward the bottom, where `attenuationColor` turns the light pinker over
  `attenuationDistance`. The base `ior` and `roughness` bend and blur what shows through.
- `clearcoat` group: `texture`'s red scales `factor`, `roughnessTexture`'s green scales `roughness` in glossy and hazy
  bands, and `normalTexture` with `normalScale` dents the coat alone. The base is matte, so all the gloss is the coat's.
- `anisotropy` group: `texture`'s red and green hold a direction in tangent space (a -1 to 1 vector stored as 0 to
  1), along the tangent in one stripe and across it in the next, and its blue scales `strength`.
- `sheen` group's `texture` and `specular` group's `colorTexture`: one packed image, its RGB tinting `color` and its
  alpha scaling sheen `roughness` or specular `factor`.
- `SphereGeometry` with `tangents`: one tangent per vertex, running round its line of latitude, for anisotropy to
  stretch along. `Mesh3D`: the two spheres, sharing it, and the backdrop's slabs.
- `View3D`: the scene, and `Container3D`, the parent the slabs join.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held near the front.
- `CanvasSource` and `Texture` from `pixi.js`: the data maps, written texel by texel, with `autoGenerateMipmaps`. Pixi
  multiplies RGB by alpha on upload, as it does a glTF's images, and the sheen and specular shaders divide it back out.
- `Application` from `pixi.js`, with `webgl: { useBackBuffer: true }`, since transmission copies the opaque colour.

## Controls

- Drag to orbit.
- Pane: `Extension` picks Transmission, Clearcoat, Anisotropy, Sheen or Specular; `Maps` off gives the right sphere the
  left one's material, and its tag then reads plain values; `Turn spheres` pauses the spheres' slow turn.

## Files

- `index.ts`: the lesson. The five material pairs, the spheres, the pane and the turn.
- `maps.ts`: `createDataMaps()`, the six data textures (mask, roughness, thickness, normal, direction and packed).
- `scene.ts`: the sphere geometry with its tangents, and the striped backdrop for transmission to bend.
- `visuals.ts`: the tags over the two spheres.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, so the extensions
have a world to reflect; `clayGeometry` and `clayMaterial` for the backdrop, `ThemePane`, `LoadingScreen`, `LabelLayer`
and `fitPortrait`.

## See also

- [Clearcoat](../materials_clearcoat/README.md): one extension's plain values, on the logo.
- [Glass and liquids](../materials_transmission/README.md): transmission, thickness and attenuation without maps.
- [PBR texture set](../materials_textures/README.md): the maps for the base layer.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_extension-maps` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
