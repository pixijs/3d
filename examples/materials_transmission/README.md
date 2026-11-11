# Glass and liquids

See-through surfaces with `Material3D`'s `transmission` group. A transmissive mesh draws after the opaque scene and
shows it, bent by the material's `ior` where light enters, and a volume inside it tints that light: it turns
`attenuationColor` after crossing `attenuationDistance`, so the more `thickness` it crosses, the deeper the colour. A
clear glass PixiJS logo sways in front of a fence of white and sky clay bars, breaking their straight edges where they
cross its letters, and a square bottle of pink liquid beside it tints the bars behind it pink and deep blue.

![A fence of twelve white and sky clay bars over the light checker floor, with a clear glass PixiJS logo in front of its left half, bending and breaking the bars seen through its letters, tagged glass, and a square bottle of pink liquid with an orange cork on the right, the bars behind it tinted pink and deep blue, tagged liquid; the pane in the top right shows a glass folder with transmission factor 1.00 and ior 1.50, and a liquid folder with thickness 1.20, attenuation Color 0xf48fb1 and attenuation Distance 1.20](reference.png)

## API

- `Material3D` with its `transmission` group (`factor`, `thickness`, `attenuationColor`, `attenuationDistance`):
  passing the group makes the surface see-through and puts the mesh in the transmission pass, and
  `material.transmission` is then its runtime object, whose values change without a shader rebuild. `factor` sets how
  much light gets through. `thickness` is the depth you tell it, in the mesh's own units, since the engine doesn't
  measure the mesh; `attenuationDistance` is in world units, so the bottle keeps scale 1 and the two mean one length.
- `Material3D` `ior` and `roughness`: `ior` sets how far light bends where it enters, 1.5 for the glass and 1.33 for
  the liquid, and at 1 nothing bends. `roughness` defaults to 1, which blurs what shows through, so both sit near 0.
- Glass shows only the opaque meshes drawn before it, never other glass, and casts no shadow: the bars stand behind,
  the two subjects stay apart on screen, and the bottle has no glass wall, which would hide the liquid.
- `BatchedMesh3D` (`setGeometryAt`, `setMaterialAt`, `setMatrixAt`, `setPassesAt`) with `RenderPassBit.OPAQUE` and
  `RenderPassBit.SHADOW`: the twelve bars as slots of one batch, a draw per clay colour on WebGPU and one for the fence
  on WebGL, placed with `Matrix4` `makeTranslation`.
- `Mesh3D` and `Container3D`: the bottle's liquid and cork under one root.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, never so far round that the logo and the bottle overlap on
  screen.
- `Application` from `pixi.js`, with `webgl: { useBackBuffer: true }`: WebGL can copy the opaque picture for the glass
  only from a back buffer, and without one the glass renders black.

## Controls

- Drag to orbit.
- Pane: the `glass` folder sets the logo's `transmission factor` and `ior`; the `liquid` folder sets the bottle's
  `thickness`, `attenuation Color` and `attenuation Distance`.

## Files

- `index.ts`: the lesson. The glass and liquid materials, the pane and the logo's sway.
- `scene.ts`: the square bottle with its cork, and the batched fence of bars behind both pieces of glass.
- `visuals.ts`: the glass and liquid tags on the floor in front of each.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo` and its `PixiLogo` type,
`clayMaterial`, `roundedBox` and `roundedCylinder`, `ThemePane`, `LoadingScreen`, `LabelLayer`, `fitPortrait`, and
`CLAY`, `THEMES` and `themeFromUrl` from the palette.

## See also

- [Specular and IOR](../materials_specular-ior/README.md): what `ior` does to the reflection.
- [PBR extension maps](../materials_extension-maps/README.md): transmission and thickness from textures.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_transmission` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
