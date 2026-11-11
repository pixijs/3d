# Sheen

The soft glow velvet and other cloth get at grazing angles. The PixiJS logo wears dusky pink velvet with a pale lilac
sheen, and rocks slowly to turn its side walls into view: faces turned towards you show the pink pile, while the edges
and walls you look across glow lilac. Two spheres in front wear the same velvet, one built with the sheen and one
without, so the sheen is the only difference between them: the sheen sphere has a pale rim all round its outline, and
the plain one darkens to its edge.

![The PixiJS logo in dusky pink velvet floating over the light checker floor, its edges and side walls glowing pale lilac, with a velvet sphere on the left tagged sheen, ringed by a lilac rim, and a plain pink sphere on the right tagged no sheen; the pane in the top right shows a sheen folder with color 0xdccefc and roughness 0.60](reference.png)

## API

- `Material3D` with its `sheen` group (`color`, `roughness`): passing the group at construction builds the sheen into
  the shader, and `material.sheen` is then its runtime object, whose values change without a rebuild. Black `color`
  turns the glow off, though the shader still runs it; low `roughness` narrows it to a thin rim and high `roughness`
  spreads it over the faces. A material built without the group has no sheen, and its `sheen` is `undefined`.
- `Material3D` `baseColor` and `roughness`: the pile under the sheen, given as one `Material3DOptions` object to both
  materials.
- `Mesh3D` and `SphereGeometry` (`radius`, `widthSegments`, `heightSegments`): the twin spheres, sharing one finely
  divided geometry, since the sheen lives on the outline. Both have `castShadow` on.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, far enough round or over the logo for its faces to flood with
  sheen, never behind it.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit; turn round to the logo's side or up over it, and its faces turn to sheen.
- Pane: the `sheen` folder sets the `color` and `roughness` of the logo's velvet, which the left sphere wears too.

## Files

- `index.ts`: the lesson. The velvet, the twin spheres, the pane and the logo's rock.
- `visuals.ts`: the tags under the two spheres.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, since sheen mirrors
its surroundings at grazing angles; `loadPixiLogo`, `ThemePane`, `LoadingScreen`, `LabelLayer`, `fitPortrait`, and
`BRAND`, `THEMES`, `mixColor` and `themeFromUrl` from the palette.

## See also

- [Clearcoat](../materials_clearcoat/README.md) and [Iridescence](../materials_iridescence/README.md): the other
  layers a `Material3D` lays over its base.
- [PBR extension maps](../materials_extension-maps/README.md): sheen from a texture, varying across the surface.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_sheen` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
