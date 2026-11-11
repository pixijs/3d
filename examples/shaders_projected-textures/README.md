# Projected textures

One cloud texture projected straight down across several meshes, by sampling it at the pixel's world position. A
lilac board, a pink sphere, a sky cube and a white torus each wear their own `Material3D` with the same extra shader
bit, which reads world `x` and `z` instead of the mesh's UVs, so one cloud runs across all of them without restarting
at any edge, and drifts slowly along x. The idea to leave with: a pattern in world space stays put while meshes move
through it, and switching to mesh UV gives each mesh its own copy instead. It changes surface colour, not light: it
doesn't test occlusion and isn't a shadow map.

![A lilac board on the light checker floor under a pink sphere, a white torus and a sky blue cube, with soft dark purple cloud patches running across the board, over the left half of the sphere and onto the cube's front face, while the torus stays clear; a pink arrow above the torus points straight down, tagged projected along −y; the pane in the top right shows Space World xz, World scale 0.24, Cloud speed 0.055, Strength 0.75 and Sphere x -1.60](reference.png)

## API

- `Material3D` with `extraBits: [cloudBit]`: each mesh's lit clay, `baseColor` and `roughness`, with the bit's code
  joined to its shader. `material.textures.cloud = cloud` fills the bit's slot once the material exists; the
  `textures` option would fill it at construction.
- `ShaderBit`: `cloudBit`, in `cloudBit.ts`. `textures: ['cloud']` declares the slot and generates `sampleCloud(uv)`;
  `bindings.material` declares `cloudScale`, `cloudOffset`, `cloudStrength` and `worldProjection`. Its WGSL and GLSL
  fill the `fragment.material` slot: they mix the `vUV` varying and `vPosition.xz * material.cloudScale` by
  `worldProjection`, add the drift, sample the cloud's red channel and darken `albedo` by it times `cloudStrength`.
- `material.data`, typed as `Material3DData` with the bit's `CloudData`: the ticker writes all four fields on every
  material each frame, so the pane and the drift reach every mesh.
- `Mesh3D` and `PlaneGeometry`: the board, and the sphere, cube and torus on the kit's clay geometry. The pane moves
  `sphere.position.x`.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping and distance and angle limits.
- `Application`, and `CanvasSource` and `Texture` from `pixi.js`: the cloud, a 128 × 128 greyscale mask drawn into a
  canvas with `addressMode: 'repeat'`, so the sampler tiles it and no seam crosses a mesh at a tile edge.

## Controls

- Drag to orbit.
- Pane: `Space` switches between `World xz` and `Mesh UV` (which hides the arrow and greys out `World scale`);
  `World scale` sizes the cloud in world units, `Cloud speed` sets its drift, `Strength` how dark it is, and
  `Sphere x` slides the sphere through it.

## Files

- `index.ts`: the lesson. The four materials and meshes, the pane and the drift.
- `cloudBit.ts`: the shader code, WGSL and GLSL in one `ShaderBit`, and its `CloudData` fields.
- `pattern.ts`: the tiling cloud mask texture.
- `visuals.ts`: the arrow and tag for the direction the cloud is projected along.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry`, `ArrowHelper`, `LabelLayer`,
`ThemePane`, `LoadingScreen`, `fitPortrait` and the palette.

## See also

- [Extra bits](../shaders_extra-bits/README.md): more `extraBits` on a `Material3D`, in both the vertex and fragment
  stages.
- [Your own material](../shaders_custom-material/README.md): a material class built from your own bit, with its own
  texture slot.
- [UV transform](../materials_uv-transform/README.md): moving a texture across one mesh's own UVs.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- shaders_projected-textures` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
