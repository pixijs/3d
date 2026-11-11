# Custom lighting model

A lighting model of your own: `createLightingBit` turns a few lines of shading maths into the bit that decides how a
material responds to light. Three spheres of one pale pink stand under one sun, wearing a soft-edged model with a purple
shade colour, Lambert, and `ToonMaterial`, the engine's own model built the same way. A probe on the large one shows the
two directions every light compares, `normal` and `lightDir`; `nDotL` is the cosine of the angle between them. The idea
to leave with: the same surface bit under a different lighting bit takes the same light differently.

![Three spheres over the light checker floor, each tagged under it: a large magenta one tagged soft shade, lit pink on the right and fading softly into purple on the left; a smaller Lambert one, pink fading to black; and a toon one in two flat pink bands, a white highlight and black. On the large sphere an accent dot carries an ink arrow tagged normal and an orange arrow tagged lightDir, joined by an arc; the pane in the top right shows softness 0.60, shadeColor 0x8b5cf6, probe angle 70 and nDotL 0.34](reference.png)

## API

- `createLightingBit`: builds a `ShaderBit` for the `fragment.lighting` slot. The factory writes the loop over the
  scene's lights; `preLighting` declares the accumulator `directLight`, `perLight` adds each light's share from
  `light.color`, `nDotL`, `attenuation` and `shadow`, and `postLighting` writes `finalColor`.
  - `lambertLightingBit`: each light adds in proportion to `nDotL`, divided by π (`INV_PI`) as the engine's PBR does.
  - `softShadeLightingBit`: one line differs in `perLight`, `smoothstep(0.0, material.softness, nDotL)`, so the light
    holds near full strength and fades over the last `softness` of `nDotL`. `postLighting` adds `material.shadeColor`
    everywhere, since `perLight` never runs where the surface faces away. `bindings.material` declares both fields.
- `mathConstantsBit`: in each lighting bit's `requires`, for `INV_PI`.
- `ShaderBit`: `surfaceBit`, the surface the soft and Lambert spheres share, which fills the `fragment.material` slot
  with `albedo *= material.baseColor.rgb`. Declaring `baseColor` in `bindings.material` lets the `baseColor` option
  fill it.
- `BaseMaterial3D` with a `descriptor` whose `bitsGpu` and `bitsGl` are `[surfaceBit, lambertLightingBit]` or
  `[surfaceBit, softShadeLightingBit]`: a surface bit then a lighting bit, the same surface under two models.
- `MaterialData`: `SoftShadeData` extends it, typing `softShade.data`, whose writes upload with no recompile.
- `srgbToLinear` and `linearToSrgb`: material fields hold linear light, so the shade colour is decoded on its way in;
  the toon sphere's base colour has π taken off in linear light, since `toonLightingBit` doesn't divide by it.
- `ToonMaterial` from `@pixi/3d/extras`: `toonLightingBit` rounds `nDotL` to `bands` steps; here `specularSize: 0`
  shrinks its highlight and `rimIntensity: 0` turns its rim off, so the bands show.
- `DirectionalLight`: the one sun, `castShadow` on, aimed with `lookAt`. The stage brings no lights of its own.
- `Mesh3D` and `SphereGeometry`: the three spheres, sharing one geometry. `Matrix4` and `Vector3`: the probe's maths.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held to a narrow range so the probe stays in sight.
- `Application`, `Color` and `DEG_TO_RAD` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `softness` and `shadeColor` set the soft model's two fields; `probe angle` moves the probe from 40° to 90°
  round from the point facing the light, and `nDotL` reads its cosine there.

## Files

- `index.ts`: the lesson. The sun, the three materials and spheres, and the pane.
- `lighting.ts`: the shader code: `surfaceBit`, and the Lambert and soft-shade lighting bits in WGSL and GLSL.
- `visuals.ts`: the probe (dot, `normal` and `lightDir` arrows, the arc) and the tags under the spheres.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false`, `ArrowHelper`,
`AngleHelper`, `DotHelper`, `LabelLayer` and its `Label`, `NARROW_BELOW`, `ThemePane`, `LoadingScreen`, `fitPortrait`
and the palette.

## See also

- [Toon shading](../materials_toon/README.md): `ToonMaterial` on its own, with its bands, rim and outline.
- [PBR, Phong and flat](../materials_lighting-models/README.md): the engine's built-in lighting models side by side.
- [Your own material](../shaders_custom-material/README.md): a material from your own bit with no lighting at all.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- shaders_lighting-model` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
