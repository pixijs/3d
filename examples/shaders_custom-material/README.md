# Your own material

A material class of your own, built on `BaseMaterial3D` from one `ShaderBit` that declares a texture and three
uniforms. `RampMaterial` colours each pixel of a clay torus from a ramp texture by how directly the surface faces the
camera, cut into flat bands, with an edge colour where the surface turns away; no light touches it. The bands follow the
camera as you orbit. The idea to leave with: once the shader is built, `material.data` changes its uniforms and
`material.textures` swaps its texture, and neither rebuilds it.

![A clay torus tipped toward the camera so its hole shows, over the light checker floor, shaded in flat candy bands from white where it faces the camera through pale pink to pink, with a purple rim round its outer edge and purple flecks at the hole where the surface turns edge-on, and its shadow on the floor; the pane in the top right shows ramp candy, bands 5, edgeWidth 0.25 and edgeColor 0x8b5cf6](reference.png)

## API

- `ShaderBit`: `rampBit`, the whole shader. `textures: ['ramp']` declares a texture slot and generates
  `sampleRamp(uv)` in both languages; `bindings.material` declares `bands`, `edgeWidth` and `edgeColor`, read as
  `material.bands` and so on. Its WGSL (`gpu`) and GLSL (`gl`) fill only the `fragment.material` slot: they read
  `normal`, the camera position and the pixel's world position, and write `albedo`. No bit fills `fragment.lighting`,
  so `albedo` reaches the screen as it is.
- `BaseMaterial3D` with `descriptor: { bitsGpu: [rampBit], bitsGl: [rampBit] }`: the material built from the bit, so
  both backends lay out the same uniforms and texture slot. `textures` fills the `ramp` slot at construction,
  and `lit = false` on the class leaves out the shadow lookup a light loop would call. The bit reads both colours
  through `decodeColor`, so the engine's encode at the end shows them as painted.
- `BaseMaterial3DOptions`, `MaterialData` and `MaterialTextures`: the types `RampMaterialOptions`, `RampData` and
  `RampTextures` extend, so `material.data.bands` and `material.textures.ramp` are typed.
- `material.data`: each scalar write queues one upload for the frame. `edgeColor` is a `vec3`, a live `Float32Array`
  view, so the class's `edgeColor` setter writes into it and calls `material.update()` to queue the upload.
- `material.textures.ramp`: the pane swaps the ramp texture into the slot without a shader rebuild.
- `Mesh3D`: the torus, on the kit's clay torus geometry, rocking slowly so the bands slide over it.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping and distance and angle limits.
- `Application`, `Color` (the edge colour setter's conversion, with `ColorSource` its input), and `Texture` and
  `CanvasSource` (each ramp, a 256 × 1 canvas gradient with `autoGenerateMipmaps: false` so band edges stay sharp),
  from `pixi.js`.

## Controls

- Drag to orbit; the bands follow the camera.
- Pane: `ramp` swaps the texture (candy, sky, sunset); `bands`, `edgeWidth` and `edgeColor` set the three uniforms.

## Files

- `index.ts`: the lesson. The material, the torus, the pane and the rock.
- `RampMaterial.ts`: the material class on `BaseMaterial3D`, its options and typed `data` and `textures`.
- `rampBit.ts`: the shader code, WGSL and GLSL in one `ShaderBit`.
- `scene.ts`: the three ramp textures, drawn on canvases.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry`, `ThemePane`, `LoadingScreen`,
`fitPortrait` and the palette.

## See also

- [Extra bits](../shaders_extra-bits/README.md): the same kind of bit added to a `Material3D` with
  `extraBits`, keeping its lighting.
- [Custom lighting model](../shaders_lighting-model/README.md): a bit for the `fragment.lighting` slot instead, so
  lights reach the surface.
- [Toon shading](../materials_toon/README.md): `ToonMaterial`, the engine's own banded material, which does take light.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- shaders_custom-material` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
