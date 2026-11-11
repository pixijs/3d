# Metal and roughness

The standard PBR material's three numbers: `baseColor`, `metallic` and `roughness`. The PixiJS logo opens as polished
orange metal, swaying slowly so the reflections slide across it. Under it, ten spheres wear the same colour at each
step of the other two: metal on the top row, non-metal on the bottom, smooth to rough from left to right. A non-metal
scatters its colour as diffuse light under a faint white reflection; a metal scatters none and tints its reflection
with `baseColor`, and `roughness` blurs that reflection from a mirror to a broad sheen.

![The orange PixiJS logo in polished metal floating over the light checker floor; under it two rows of five orange spheres, the top row metal and the bottom row matte orange, each going from a sharp mirror on the left to a soft even sheen on the right, with metallic ↑ named over the top row and roughness → under the bottom one; the pane in the top right shows baseColor 0xf2a65a, metallic 1.00 and roughness 0.10](reference.png)

## API

- `Material3D` `baseColor`, `metallic` and `roughness`: built from an options object, then plain properties you can
  write at any time, with no shader recompile. `metallic` picks between a non-metal at 0 and a metal at 1, and
  `roughness` runs from a mirror at 0 to a broad sheen at 1.
- `Mesh3D` `material`: setting it re-skins each of the logo's meshes, which already exist. A new mesh takes its
  material in its options, as the spheres do.
- `SphereGeometry` and `Mesh3D`: the ten spheres, sharing one geometry, each with a `Material3D` of its own. They share
  one shader, so they draw back to back: one draw on WebGL, one a sphere on WebGPU.
- `Vector3`: where each sphere stands, from its step of `metallic` and `roughness`.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, near face-on to the spheres, and backed off with `zoom()` and
  its distance limits on a narrow window.
- `Application` and `Renderer` from `pixi.js`: the app, and the renderer whose `resize` refits the camera.

## Controls

- Drag to orbit.
- Pane: `baseColor` sets the logo's colour and repaints the spheres; `metallic` and `roughness` set the logo.

## Files

- `index.ts`: the lesson. The logo's material, the ten spheres, the pane and the logo's sway.
- `scene.ts`: the steps of `roughness` and `metallic`, and where each sphere stands.
- `framing.ts`: `fitBesidePane`, which backs the camera and fog off until the spheres fit and the logo clears the pane.
- `visuals.ts`: the `metallic` and `roughness` axis names.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, with its
key light's `castShadow` off; `loadPixiLogo`, `ThemePane`, `LoadingScreen` and
`LabelLayer`.

## See also

- [PBR texture set](../materials_textures/README.md): the same values read from maps, texel by texel.
- [Clearcoat](../materials_clearcoat/README.md): a clear lacquer over the base, with a roughness of its own.
- [PBR, Phong and flat](../materials_lighting-models/README.md): `PhongMaterial` and `FlatMaterial`, cheaper models
  beside `Material3D`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_pbr` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
