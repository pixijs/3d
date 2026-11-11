# Specular and IOR

How strongly a non-metal reflects. Plastic, glass and water mirror a few percent of the light that meets them head-on
and nearly all of it edge-on: `ior` sets the head-on share, `((ior - 1) / (ior + 1))²`, and leaves the edges alone,
while the `specular` group scales the whole reflection and tints its head-on part. The PixiJS logo, in glossy black
plastic, sways to slide the reflected sunset across its walls, and five spheres under it wear the same plastic at the
`ior` tagged under each, from 1, which reflects nothing head-on, to diamond's 2.42.

![The PixiJS logo in glossy black plastic floating over the light checker floor, above a row of five black spheres tagged 1.00, 1.33, 1.50, 1.77 and 2.42, whose reflections of the sunset grow brighter from left to right; the pane in the top right shows ior 1.50 and a specular folder with factor 1.00 and color 0xffffff](reference.png)

## API

- `Material3D` `ior`: a plain property, 1.5 by default, as glass and most plastics have. It sets the head-on
  reflection, 2% for water, 4% for glass and 17% for diamond, and changes without a shader rebuild.
- `Material3D` with its `specular` group (`factor`, `color`): only the constructor can turn the group on, and `{}`
  takes its defaults, factor 1 and white. `material.specular` is then its runtime object, typed `SpecularProps`:
  `factor` scales the whole reflection, edges included, down to none at 0, and `color` tints the head-on reflection
  while the edges stay white. None of the three changes a metal.
- `Material3D` `baseColor`, `metallic` 0 and `roughness` 0.1: a near-black, polished plastic, so the reflection is
  what shows. The row reads them back from the logo's material.
- `Mesh3D` and `SphereGeometry`: the five spheres, sharing one geometry, each with its own `ior` given at
  construction; `Vector3` places them under the view's `Container3D` root.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with `enableZoom` off and limits that never see the row
  edge-on.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit; there's no zoom.
- Pane: `ior` sets the logo's; the `specular` folder sets its `factor` and `color`, and the five spheres follow both,
  so they differ from the logo by `ior` alone.

## Files

- `index.ts`: the lesson. The plastic, the pane and the logo's sway.
- `scene.ts`: the row of spheres and the `ior` of each, the logo's sway, and a night sky lifted so the black logo
  stands out on the dark theme.
- `visuals.ts`: the `ior` tag under each sphere.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, with
the form light left out and the key's shadow off; `loadPixiLogo`, `ThemePane`,
`LoadingScreen`, `LabelLayer`, `fitPortrait`, and `BRAND`, `THEMES`, `mixColor`, `screenColor` and `themeFromUrl` from
the palette.

## See also

- [Metal and roughness](../materials_pbr/README.md): `metallic` and `roughness`, the base the reflection sits on.
- [Glass and liquids](../materials_transmission/README.md): `ior` again, bending the light that passes through.
- [Clearcoat](../materials_clearcoat/README.md): a second reflection, from a clear coat over the base.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_specular-ior` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
