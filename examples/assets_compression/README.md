# Compression

Every kind of compressed glTF the engine reads, one model each, all loaded with the same `Assets.load` call. A glTF
file can compress its geometry, as quantized integers, meshopt or Draco, and its textures, as KTX2, WebP or AVIF. The
loader reads which extensions a file uses and decodes what it must, so a compressed file loads like any other; only
KTX2 needs a line of setup. No sample model comes in every encoding, so the picture shows five Khronos samples, each
tagged with the one it uses. AVIF loads the same way, but no Khronos sample uses it.

![Five models on the light checker floor, each tagged on the floor in front: at the back a yellow rubber duck tagged quantized, a walking silver robot tagged meshopt and a walking white figure with a Cesium logo head tagged Draco; in front a copper wall lamp tagged KTX2 and a pair of aviator sunglasses tagged WebP; the pane in the top right shows only the Compression title and the theme row](reference.png)

## API

- `Assets.load` from `pixi.js` with the `Scene3DSource` type: each file loads with the same call, since the loader
  reads the extensions it lists and decodes them:
  - `KHR_mesh_quantization` (the duck): positions, normals and UVs as 8- or 16-bit integers, read as the vertex
    formats they are, so they stay that size on the GPU.
  - `KHR_meshopt_compression` (BrainStem): quantized geometry and animation packed for the download and unpacked by
    meshopt's decoder, which ships inside `@pixi/3d`. Older files say `EXT_meshopt_compression`, which loads the same.
  - `KHR_draco_mesh_compression` (Cesium Man): the smallest geometry download, unpacked to floats by Google's Draco
    decoder, fetched from a CDN the first time a file needs it unless `setDracoDecoderPath` points at a copy you host.
  - `KHR_texture_basisu` (the barn lamp): KTX2 images that stay compressed on the GPU, transcoded on load to a format
    the device reads. Pixi fetches the transcoder from a CDN unless pixi's `setKTXTranscoderPath` points at a copy.
  - `EXT_texture_webp` (the sunglasses, whose geometry is Draco too): smaller images, decoded by the browser to
    full-size pixels. `EXT_texture_avif` works the same way in a browser that decodes AVIF, which pixi's `detectAvif`
    tells.
- `extensions.add(loadKTX2)` from `pixi.js`: KTX2 needs pixi's KTX2 loader, which isn't in the default set. In an app,
  `import 'pixi.js/ktx2'` adds it.
- `Model3D` with `autoPlay: true`: loops each file's first clip, so the robot and the figure walk rather than stand in
  their bind pose.
- `getLocalBounds` into a `Box`, then `Sphere` `setFromBox`: `standModel` scales each model until the sphere round it
  fits its place, and stands it on the floor on a `Container3D` that sways it about its middle.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping, no panning and a polar limit above the floor.
- `Application` from `pixi.js`, with `webgl: { useBackBuffer: true }`: the lamp's bulb and the sunglasses' lenses are
  glass, which WebGL can only draw from a copy of a back buffer.

## Controls

- Drag to orbit.
- Pane: the theme row only. The files have nothing to switch.

## Files

- `index.ts`: the lesson. The KTX2 loader, the five files with what each encoding does, and loading them.
- `scene.ts`: `standModel`, which scales a model to its place and stands it on the floor.
- `visuals.ts`: the tag in front of each model.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, so the metal has a
world to reflect; `ThemePane`, `LoadingScreen`, `LabelLayer` and `fitPortrait`.

## Models

All five come from the [Khronos glTF sample assets](https://github.com/KhronosGroup/glTF-Sample-Assets) through the
asset mirror:

| Model                                  | Encoding       | Mirror name                   | Licence                    |
| -------------------------------------- | -------------- | ----------------------------- | -------------------------- |
| Duck, by Sony                          | quantized      | `gltf.DuckQuantized`          | SCEA Shared Source License |
| BrainStem, by Keith Hunter             | meshopt        | `gltf.BrainStemMeshopt`       | Smith Micro's Poser EULA   |
| Cesium Man, by Cesium                  | Draco          | `gltf.CesiumManDraco`         | CC BY 4.0                  |
| Anisotropy Barn Lamp, by Eric Chadwick | KTX2           | `gltf.AnisotropyBarnLampKtx2` | CC BY 4.0                  |
| Sunglasses Khronos, by Eric Chadwick   | WebP and Draco | `gltf.SunglassesKhronosDraco` | CC BY 4.0                  |

The logos on them follow their owners' trademark terms.

## See also

- [Loading glTF](../assets_gltf/README.md): loading one file and placing several models from its source.
- [Model viewer](../start_model-viewer/README.md): any file dropped on the page, scaled and framed the same way.
- [Glass and liquids](../materials_transmission/README.md): the glass the lamp and the sunglasses use, and why WebGL
  needs the back buffer.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- assets_compression` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
