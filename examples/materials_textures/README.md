# PBR texture set

A PBR material built from five images: base colour, metallic-roughness, normal, occlusion and emissive maps, and what
each one adds. The Damaged Helmet sways slowly over the floor in its chrome, paint and glowing visor, and the cards
along the bottom show the texture each slot of its material holds now. Each map scales a plain value the material also
has, and switching a map off puts a neutral texture in its slot, so a swap never builds a new shader.

![The Damaged Helmet floating over the light checker floor, its chrome and visor mirroring the sky and a cyan ring glowing on the visor; along the bottom, five cards tagged baseColor, metallicRoughness, normal, occlusion and emissive show each map; the pane in the top right shows a material.textures folder with all five ticked](reference.png)

## API

- `Material3D` with `baseColorTexture`, `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture` and an
  `emissive` group with its `texture`: the five maps the file ships, written out as you'd build them from five images
  of your own. The `emissive` group is what gives the material an emissive slot at all.
- `Material3D` `metallic` and `roughness`, both 1: the metallic-roughness map's blue scales `metallic` and its green
  `roughness`, so 1 lets the map decide. `normalScale` and `occlusionStrength` scale the other two maps the same way.
- `material.textures.<slot>` (`baseColor`, `metallicRoughness`, `normal`, `occlusion`, `emissive`): swaps a map at run
  time with no new shader. A slot always holds a texture, so a map switched off puts back `Texture.WHITE`, a black
  texel for emissive, or a flat normal map, which keeps normal mapping compiled in.
- `Assets.load` with `model('gltf.DamagedHelmet')` from the asset manifest gives a `Scene3DSource`, whose `materials`
  hold the maps; `Model3D` (`source`, `castShadow`, `receiveShadow`, `scale`) builds the helmet, and
  `getChildByLabel` finds its one `Mesh3D`, whose `material` the lesson replaces.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, close enough to see the seams and creases.
- `Application`, `Assets`, `Texture`, `BufferImageSource` and `BitmapText` from `pixi.js`: `BufferImageSource` with
  `format: 'rgba8unorm'` makes the one-texel black and flat normal textures, and `BitmapText` the slot names under
  the compact cards on a small screen.

## Controls

- Drag to orbit.
- Pane: the `material.textures` folder switches each map on and off, `baseColor`, `metallicRoughness`, `normal`,
  `occlusion` and `emissive`. The paint and the chrome hide most of what `normal` and `occlusion` do, so switch
  `baseColor` and `metallicRoughness` off to see them on a bare white helmet.

## Files

- `index.ts`: the lesson. The material from five maps, the neutral texture for each slot, and the pane.
- `scene.ts`: the helmet, its five maps read off the loaded material, its sway, and the one-texel textures.
- `visuals.ts`: the row of cards, each showing the texture its slot holds now.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, so the chrome and
the visor have a world to mirror; `InsetView` for the cards in texture mode, `LABEL_FONT`, `NARROW_BELOW` and
`overlayColor`; `ThemePane`, `LoadingScreen`, `fitPortrait`, and `THEMES` and `themeFromUrl` from the palette.

## See also

- [Metal and roughness](../materials_pbr/README.md): `metallic` and `roughness` as plain values, before any map.
- [PBR extension maps](../materials_extension-maps/README.md): textures for the layers over the base, such as
  clearcoat, sheen and transmission.
- [Tangent space](../geometry_tangent-space/README.md): the tangents a normal map reads its tilt against.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_textures` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
