# Extra bits

Your own shader code added to a built-in material with `extraBits`. The PixiJS logo keeps its lit, lacquered
`Material3D` while two bits act on it: a wobble that runs once for every vertex and slides it sideways along a wave
that climbs the logo, and a dissolve that runs once for every pixel, throws away the pixels under a noise cut and
lights a glowing rim just above it. The idea to leave with: a `ShaderBit` is a plain object whose code fills named
slots of the material's shader, its `bindings.material` fields join `material.data`, and it carries its code twice,
WGSL for WebGPU and GLSL for WebGL.

![The pink PixiJS logo over the light checker floor, leaning in a gentle wave, with about a third of it eaten away in rounded holes whose edges glow sky blue, and no shadow under it; the pane in the top right shows dissolve 0.35, Edge colour 0x38bdf8 and wobble 0.10](reference.png)

## API

- `Material3D` with `extraBits: [wobbleBit, dissolveBit]`: the bits' code joins the shader after the built-in
  features, fixed for the material's life. The rest are the logo's enamel settings (`baseColor`, `roughness`,
  `specular`, `clearcoat`, `fog: false`).
- `ShaderBit`: each bit's type.
  - `wobbleBit` fills the `vertex.afterTransform` slot: it moves `worldPosition.x` by a sine of the vertex's height
    and the clock, then builds `clipPosition` (`gl_Position` in GLSL) again from `camera.uViewProjectionMatrix`. It
    declares `wobble` and `wobbleTime` in `bindings.material`.
  - `dissolveBit` puts its value noise functions in `header`, passes the model-space position to the fragment stage
    through the `vDissolveXY` varying (`interStage`, written in `vertex.beforeTransform`), and in the
    `fragment.material` slot calls `discard` where the noise is at or under `material.dissolve`, fades `albedo` and
    adds `material.dissolveEdgeColor` to `emissive` along the rim.
- `material.data`, typed as `Material3DData` with the bits' `WobbleData` and `DissolveData`: the pane binds `dissolve`
  and `wobble` directly, and the ticker writes `wobbleTime` every frame. `dissolveEdgeColor` is a `vec3`, so it's
  assigned whole, which queues the upload; writing one channel in place wouldn't.
- `srgbToLinear`: material data holds linear light, so the edge colour is decoded on its way in.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping and distance and angle limits.
- `Application`, and `Color` (the edge colour's conversion to rgb), from `pixi.js`.

The shadow pass draws casters with its own shader, which extra bits never reach, so the logo casts no shadow and the
stage's key light doesn't render a shadow map (`stage.key.castShadow = false`).

## Controls

- Drag to orbit.
- Pane: `dissolve` sets how much of the logo is gone, `Edge colour` the rim's glow and `wobble` the wave's widest
  offset in world units.

## Files

- `index.ts`: the lesson. The material with its extra bits, the logo, the pane and the clock.
- `dissolveBit.ts`: the dissolve's shader code, WGSL and GLSL, and its `DissolveData` fields.
- `wobbleBit.ts`: the wobble's shader code, WGSL and GLSL, and its `WobbleData` fields.
- `floatLiteral.ts`: writes a number into shader source as a float both languages read.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo` (with `material: 'source'`,
then `logo.setMaterial`), `ThemePane`, `LoadingScreen`, `fitPortrait` and the palette.

## See also

- [Your own material](../shaders_custom-material/README.md): a whole material built from your own bit on
  `BaseMaterial3D`.
- [Custom lighting model](../shaders_lighting-model/README.md): a bit that replaces how a material responds to
  light.
- [Projected textures](../shaders_projected-textures/README.md): an extra bit that projects a texture onto the scene.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- shaders_extra-bits` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
