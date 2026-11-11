# Loading glTF

Load a glTF file once with pixi's `Assets`, build three `Model3D`s from it, find each copy's parts by label, and repaint
them all through the source's material. The Cesium Milk Truck (`model('gltf.CesiumMilkTruck')` from
`examples/assets/manifest.ts`) parks three times in a row, painted pale sky; the middle copy rolls out of its bay and
back, and only its wheels turn. `Assets.load` hands back a `Scene3DSource`, a template that holds the file's geometry,
materials and textures and never goes into the view: each model builds its own nodes but draws with the source's
resources, so a copy costs nodes, not a download or GPU memory.

![Three pale sky milk trucks with a green and blue logo parked in a row on the light checker floor, three quarters on, tagged trucks[0], trucks[1] in pink and trucks[2]; pink tags with leader lines name the middle truck's axles Wheels and Wheels.001; the pane in the top right shows baseColor 0x9adcfb and Rolling trucks[1]](reference.png)

## API

- `Assets.load` from `pixi.js` with the `Scene3DSource` type: importing `@pixi/3d` registers its glTF loader, which
  `Assets` picks by the file's extension.
- `Model3D` with `source`, `x` and `rotation`: three copies from one source. The file's `Wheels` clip gives each a
  `player`, which stays stopped.
- `getChildrenByLabel(/^Wheels/, true)`: every node takes the file's node name as its `label`, and `true` searches
  the whole tree, since the axles sit four levels down. A search walks the tree, so the example searches once and
  keeps what it finds.
- `source.material['truck']`: the body's material, shared by every copy, so one write to its `baseColor` repaints all
  three. `baseColor` multiplies the texture, so the grille and bumper stay dark, and the tyres, glass and trim keep
  materials of their own.
- `Container3D` `rotation.y` on each wheel node: turned by distance over the wheel's radius, so the truck rolls without
  slipping. Writing `rotation` replaces the turn the file gave each wheel in its `quaternion`.
- `getLocalBounds()`, `toLocal`, `toGlobal`, `Ray` (`intersectBoxT`) and `Vector3`: the visuals pin each wheel tag to
  the hub facing the camera, and hide it while another truck's box stands in front.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping, no panning and a polar limit above the floor.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `baseColor` repaints the shared material on every copy; `Rolling` picks the copy that rolls and turns its
  wheels.

## Files

- `index.ts`: the lesson. Loading the file, three models from its source, the label search, the shared material, and
  the roll.
- `visuals.ts`: a tag naming each copy, and tags on the rolling copy's wheels naming the nodes the search found.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its fog pushed back, `ThemePane`,
`LoadingScreen`, `LabelLayer` and `fitPortrait`, with `CLAY`, `THEMES` and `themeFromUrl`.

## See also

- [glTF scenes](../assets_gltf-scenes/README.md): a file's lights, cameras and several scenes.
- [Unload and rebuild](../assets_lifetime/README.md): what a model and its source free when they go.
- [Find and reparent](../scene_find-and-reparent/README.md): searching a scene by label and moving nodes between
  parents.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- assets_gltf` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
