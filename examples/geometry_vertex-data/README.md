# Vertex colours and custom attributes

Per-vertex data beyond the shape: `colors` that tint the material once `vertexColors` is on, a second set, `colors1`,
that never tints and so carries a mask, and an attribute of your own added with `addAttribute`. A low-poly mound of
61 vertices wears a colour per side, pink, orange, purple and blues under a white cap, and a shader bit reads the
mask and the phase to roll a ripple down and round it: the mask pins the rim to the floor, and the phase makes the
crest arrive late further down the slope.

![A faceted low-poly mound on the light checker floor, its sides coloured purple on the left, orange facing the camera and deep pink on the right, blending into each other and into a pale cap at the peak; the pane in the top right shows vertexColors ticked, maskStrength 1.00, phaseScale 1.00 and liftHeight 0.50](reference.png)

## API

- `Geometry3D` `colors`: a `Uint8Array` of four bytes a vertex (RGBA), read as 0 to 1. Vertex colours are linear
  light, so each palette colour is decoded with `srgbToLinear` before it's stored.
- `Geometry3D` `colors1`: a second set of the same shape that materials never tint with. It reaches the shader as
  `aColor1`; here its red holds how far a vertex may move, 1 at the peak to 0 at the rim.
- `geometry.addAttribute('aPhase', { buffer, format: 'float32' })`: a value of your own with its own name and format,
  added after construction and before the first render, which packs each attribute by its `format`.
- `Material3D` `vertexColors`: the mesh reads it when it builds its shader, so turning it off or on calls
  `mound.invalidate()` to build it again.
- `Material3D` `baseColor` (a light grey the colours multiply), `roughness`, `flatShading` and `extraBits`.
- `ShaderBit`: `rippleBit` declares `attributes` (`aColor1` and `aPhase`, typed as the shader reads them) and
  `bindings.material` fields (`liftHeight`, `maskStrength`, `phaseScale`, `waveTime`), and adds WGSL under `gpu` and
  GLSL under `gl` to the vertex stage's `beforeTransform`, lifting `position.y`. The fields live on `material.data`,
  which the pane binds and the frame loop writes `waveTime` into, so the ripple runs on the GPU.
- `Mesh3D` with `geometry`, `material` and `parent`.
- `stage.key.position` and `lookAt`: the key comes in low from the left, so the facets step darker round the right.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`; `Color` from `pixi.js` splits a hex colour into `red`, `green` and `blue`.

## Controls

- Drag to orbit.
- Pane: `vertexColors` turns the tint off and on; `maskStrength` at 0 lifts every vertex the full height, rim and
  all; `phaseScale` at 0 lifts every vertex at once; `liftHeight` sets how high the ripple lifts, and 0 stills it.

## Files

- `index.ts`: the lesson. The three per-vertex arrays, the geometry and its added attribute, the material and the pane.
- `rippleBit.ts`: the shader bit that reads `aColor1` and `aPhase`, in WGSL and GLSL, and the `RippleMaterial` type.
- `scene.ts`: the mound's positions, normals and indices, ring by ring, and the palette colour of each vertex.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen` and
`fitPortrait`, and the palette's `CLAY`, `DARK_ORANGE` and `mixColor`.

## See also

- [Geometry from arrays](../geometry_custom/README.md): the positions, normals, uvs and indices every geometry starts
  from.
- [Vertex formats](../geometry_vertex-formats/README.md): the formats vertex data can be stored in.
- [Extra bits](../shaders_extra-bits/README.md): more of what a `ShaderBit` can add to a built-in material.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_vertex-data` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
