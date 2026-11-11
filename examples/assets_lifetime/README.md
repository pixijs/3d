# Unload and rebuild

Take a castle out of the scene three ways, `removeChild`, `unload()` and `destroy(options)`, see what each one keeps,
and bring it back. Three clay castles, each with its own geometry, clay and painted map, are drawn once and taken out:
`removeChild` keeps the GPU and CPU copies, so its castle shows as a see-through ghost and comes back with no upload;
`unload()` frees the GPU copy and keeps the vertex arrays and pixels, drawn as a wireframe, so the next render uploads
them again; `destroy()` with every `Destroy3DOptions` flag on keeps nothing, so the castle has to be built again. Every
flag is off by default, since children, geometry, materials and textures are often shared, and a flag left off leaks
what it guards.

![Three bays in a row on the light checker floor with their castles taken out: on the left a see-through grey castle tagged removeChild keeps GPU+CPU, in the middle an ink wireframe castle tagged unload keeps CPU, and on the right an empty dashed outline tagged destroy keeps nothing; the pane in the top right shows in scene unticked, the destroy options children, geometry, material, texture and textureSource all ticked, and a memory folder with GPU 1.35 MB, CPU 2.03 MB, leaked 0 castles and a disabled Free leaked button](reference.png)

## API

- `container.removeChild(castle.root)`: every way out starts here, and on its own it frees nothing. The castle stays
  on the GPU, and `addChild` shows it again at once.
- `castle.root.unload()`: a `Container3D` calls each child's `unload()`, and each `Mesh3D` frees its geometry's GPU
  copy and keeps the vertex arrays. It leaves materials alone, since they're often shared, so the castle calls
  `material.unload()` on each of its own `Material3D`s to give back the map's GPU copy and keep its pixels. A glTF
  `Model3D`'s own `unload()` does both. The next render after `addChild` uploads them again.
- `castle.root.destroy(options)` with `Destroy3DOptions`: `children` destroys the meshes under the root, `geometry`
  each mesh's `Geometry3D` and its GPU buffers, `material` each mesh's material, `texture` the textures of the
  materials it destroys, and `textureSource` the sources behind them. Each flag is `false` by default, and one left
  off leaves that part alive with nothing using it.
- Freeing a leak by hand, through the castle's own lists: `mesh.destroy()`, `geometry.destroy(true)` (`true` destroys
  its own buffers too), `material.destroy()`, then `source.destroy()` and `texture.destroy()` for any not yet
  `destroyed`. Meshes, geometry and materials ignore a second destroy; pixi's textures and sources don't.
- `Texture` and `CanvasSource` from `pixi.js`: the painted map is built from a canvas directly rather than with
  `Texture.from`, which would also file it in pixi's global cache, a reference that stays until the texture itself is
  destroyed.
- `TextureSource` from `pixi.js` and `Geometry3D` `buffers`: the memory readout counts bytes from public sizes and
  follows each geometry's and source's `'unload'` and `'destroy'` events, since the engine has no memory readout.
- `Mesh3D`, `ConeGeometry`, `PlaneGeometry` (`flipV`), `Container3D`, `PointData3D` and `Vector3`: the castles, the
  bays, and the visuals' own ghost, wireframe and leaked-map meshes, which share nothing with a castle.
- `Box.fromCenterSize` on `stage.key.shadow.bounds`: pinned round the bays, so the shadow box doesn't refit as castles
  leave and come back.
- `View3D` with `setSize` and `position`, so a wide screen keeps the row clear of the pane, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit round the middle castle.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `in scene` brings every castle back (rebuilding the destroyed one) or takes them all out again. The
  `destroy options` folder (`children`, `geometry`, `material`, `texture`, `textureSource`) rests while the castles are
  in; while they're out, a change rebuilds the destroy bay's castle and destroys it again with the new flags, and the
  tag shows in pink what it leaks. The `memory` folder reads `GPU` and `CPU` in MB and how many castles `leaked`, and
  `Free leaked` frees them.

## Files

- `index.ts`: the lesson. `takeOut` with `removeChild`, `unload()` and `destroy(options)`, `bringBack`, and
  `freeLeaked`.
- `scene.ts`: the bays, `createCastle`, which lists every geometry, material and texture it builds, the painted map,
  and the camera framing.
- `memory.ts`: the GPU and CPU bytes the castles hold, and which castles leaked.
- `controls.ts`: the pane's rows.
- `visuals.ts`: what each bay still keeps (a ghost, a wireframe or nothing), pink for a leak, and the tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `createClayMaterial`, `roundedBox`,
`roundedCylinder`, `createHelperMaterial`, `GHOST_OPACITY`, `WireframeHelper`, `PathHelper`, `LabelLayer`,
`ThemePane`, `LoadingScreen` and `fitPortrait`, with `BRAND`, `CLAY`, `cssColor`, `mixColor`, `THEMES` and
`themeFromUrl`.

## See also

- [Loading glTF](../assets_gltf/README.md): a `Scene3DSource` shared by several models, which a destroy must spare.
- [Model viewer](../start_model-viewer/README.md): swapping a model with `destroy` and `Assets.unload`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- assets_lifetime` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
