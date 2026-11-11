# Clearcoat

A clear lacquer over a material's base, with a roughness of its own, like car paint. The PixiJS logo wears a satin
purple metallic paint under a mirror-smooth coat, and sways slowly to turn its sides edge-on, where a coat reflects
most. Two spheres in front wear the same base, one built with the coat and one without, so the coat is the only
difference between them: the coated one keeps a sharp pin of light that the bare one spreads into a soft glow.

![The purple PixiJS logo floating over the light checker floor, with a glossy coated sphere on the left and a satin bare one on the right, tagged clearcoat and no clearcoat; the pane in the top right shows roughness 0.50 and a clearcoat folder with factor 1.00 and roughness 0.05](reference.png)

## API

- `Material3D` with its `clearcoat` group (`factor`, `roughness`): passing the group at construction builds the coat
  into the shader, and `material.clearcoat` is then its runtime object, whose values change without a rebuild. A
  material built without the group has no coat, and its `clearcoat` is `undefined`.
- `Material3D` `baseColor`, `metallic` and `roughness`: the paint under the coat, which the coat's own `roughness`
  doesn't touch.
- `Mesh3D` and `SphereGeometry`: the twin spheres, sharing one geometry.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with distance and angle limits that keep the logo readable.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `roughness` sets the base of the logo and both spheres; the `clearcoat` folder sets the coat's `factor` and
  `roughness`.

## Files

- `index.ts`: the lesson. The paint, the twin spheres, the pane and the logo's sway.
- `visuals.ts`: the tags under the two spheres.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, so the coat has a
world to reflect; `loadPixiLogo`, `ThemePane`, `LoadingScreen`, `LabelLayer` and `fitPortrait`.

## See also

- [Metal and roughness](../materials_pbr/README.md): the base layer's `metallic` and `roughness` on their own.
- [Sheen](../materials_sheen/README.md) and [Iridescence](../materials_iridescence/README.md): the other layers a
  `Material3D` lays over its base.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_clearcoat` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
