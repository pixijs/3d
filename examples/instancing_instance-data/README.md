# Per-instance data

Every slot of a `BatchedMesh3D` can carry numbers of its own that a shader bit reads, so 18,840 cubes ripple while
the CPU writes one number a frame. The batch declares a `wave` and a `tint` field once with `instanceData`; each
slot's row holds its place on the wave, its height and its colour, and the bit lifts and tints the slot on the GPU.
Every matrix is written once, so on the front row a grey ghost marks where one slot's matrix holds it, and a pink
arrow its lift whenever the lift is long enough to draw one.

![A field of small rounded cubes in sky, pale sky, lilac and purple stretching back over the light checker floor into the haze, rising and falling in rings round a point behind the middle; on the front row the middle cube sits a little above its grey ghost, its lift too short for the arrow to show, and two tags below, matrix and lift, point at the ghost; the pane in the top right shows Wave speed 2.4, Pattern ripple and Colours 4](reference.png)

## API

- `BatchedMesh3D` `instanceData`: the fields every slot carries, declared once, each `{ value, type: 'vec4<f32>' }`
  with the value a slot starts with. `wave` uses two lanes, its phase offset and height; `tint` uses rgb.
- `field.instanceData` (`data`, `stride`, `offset`, `fields`) and its `update()`: a new pattern or colour count fills
  one field in every row and uploads them all once. `setInstanceDataAt(i, field, x, y, z, w)` writes one row, for a
  few scattered slots.
- `BatchedMesh3D` (`size`, `cull: 'gpu'`, `parent`) with `setGeometryAt`, `setMaterialAt`, `setMatrixAt` and
  `setPassesAt`: every slot gets one clay cube, one material, a `Matrix4` from `makeScale` and `setPosition`, and
  `RenderPassBit.OPAQUE`, once. The GPU culls a slot by where its matrix puts it, not where the bit lifts it.
- `ShaderBit`: `waveBit` names the batch's fields under `bindings.instance`, matched by name and type, and reads
  them as `instance.wave` and `instance.tint`; `bindings.material` adds `wavePhase`. Its vertex `beforeTransform`
  adds the lift to `modelMatrix[3].y`, and its fragment `material` stage multiplies `albedo` by the tint, in WGSL under
  `gpu` and GLSL under `gl`.
- `extraBits`, passed through the kit's `clayMaterial`: the bit joins the white clay's shader and adds `wavePhase`
  to `material.data`, which the ticker writes each frame.
- `stage.key.castShadow = false`: the shadow pass doesn't run material bits, so a cast shadow would stay at rest.
- `srgbToLinear`, and `Color` from `pixi.js`, in `scene.ts`: the colour ramp in linear light, as `albedo` is.
  `PointData3D` types a slot's position.
- `Mesh3D` with `castShadow: false`, `Vector3` and `view3d.worldToScreen` in `visuals.ts`: the probe's ghost, its
  arrow and its tags. `Point` from `pixi.js` holds their screen points.
- `View3D`: the 3D scene inside pixi's stage, built at the screen's `width` and `height`, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, within 20° of the front so the fog hides the field's edges.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `Wave speed` changes only the number the ticker adds each frame, and 0 stops the wave; `Pattern` (`ripple`,
  `diagonal`, `spiral`) rewrites `wave` in every row; `Colours` rewrites `tint` in every row with the first 1 to 7
  colours of the ramp.

## Files

- `index.ts`: the lesson. The batch and its `instanceData`, the one-time matrix writes, the row rewrites and the
  per-frame phase.
- `waveBit.ts`: the shader bit, and the same lift in JavaScript for the visuals.
- `scene.ts`: where each slot stands, its phase offset for each pattern, its height, and the colour ramp.
- `visuals.ts`: the probe's ghost where its matrix holds it, the lift arrow, and the two tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry` and `clayMaterial` with
`extraBits`, `ghostMaterial`, `ArrowHelper`, `LabelLayer`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [BatchedMesh3D](../instancing_batched-mesh/README.md): the batch's slots, and moving them by rewriting matrices.
- [Extra bits](../shaders_extra-bits/README.md): what else a `ShaderBit` can add to a material.
- [Vertex colours and custom attributes](../geometry_vertex-data/README.md): data per vertex rather than per slot,
  read by a shader bit the same way.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- instancing_instance-data` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
