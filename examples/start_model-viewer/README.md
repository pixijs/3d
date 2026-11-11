# Model viewer

Drop a .glb or .gltf file on the page and it shows on the stage, scaled, stood on the floor, framed and lit. A dropped
`File` gets a URL from `URL.createObjectURL`, which `Assets.load` reads with the parser named, since the URL has no
extension to pick one by; `new Model3D` builds the file's scene and plays its first animation. The picture shows the
PixiJS logo file, on show until you drop your own, and each model a new file replaces is destroyed and unloaded.

![The pink PixiJS logo model standing on the light checker floor with its shadow behind it, and a dashed pill along the bottom reading Drop or choose a .glb or .gltf to view it; the pane in the top right shows the file name pixijs-logo.glb, orbit.autoRotate off and a Frame model button](reference.png)

## API

- `Assets.load` from `pixi.js` with `{ src, parser }`: reads the file's object URL as `'glb'` or `'gltf'` and resolves
  to a `Scene3DSource`. `Assets.unload(url)` frees a replaced file's geometry, materials and textures, keyed by the
  same URL after `URL.revokeObjectURL` has let the file go.
- `Model3D` with `source` and `autoPlay: true`: builds the file's scene and loops its first animation; a file without
  one stands still. `destroy({ children: true })` takes the model it replaces down.
- `getLocalBounds` into a `Box`, then `Sphere` `setFromBox`: the sphere round the model, which `placeModel` scales to a
  2-unit radius and stands on the floor, so any file, a 6 cm avocado or a 40 m building, suits the stage.
- `Light` and `Container3D`: `hideLights` hides the lights a file brings, so the stage lights every model alike.
- `View3D` and its `camera`: `fov` and `position` frame the sphere clear of the hint along the bottom.
- `OrbitCamera` from `@pixi/3d/extras`: `autoRotate` and `autoRotateSpeed` turn it; `minDistance`, `maxDistance` and
  `maxPolarAngle` keep it out of the model and above the floor; `zoom()` keeps a chosen zoom across a resize; and
  `autoUpdate: false` with `update(ticker)` moves it in step with the app's ticker.
- `extensions.add(loadKTX2)` from `pixi.js`: adds pixi's KTX2 loader, which isn't in its default set; in an app,
  `import 'pixi.js/ktx2'` does the same. `Application` and `DEG_TO_RAD` from `pixi.js`.

## Controls

- Drag to orbit, scroll to zoom.
- Drop a .glb or .gltf anywhere on the page, or press the hint along the bottom to choose one, the way in on a phone. A
  pink dashed frame shows while a file is dragged over the page, and the hint says when a file is loading or couldn't
  load. A .gltf that keeps its buffers or images in files of their own can't load from a drop.
- Pane: the first row names the file on show; `orbit.autoRotate` turns the camera round the model; `Frame model` puts
  the camera back in front of it.

## Files

- `index.ts`: the lesson. Loading a dropped file, building the model, framing it and freeing the one it replaces.
- `scene.ts`: `placeModel`, which scales a model to the stage and stands it on the floor, and `hideLights`.
- `dropZone.ts`: the hint, the file picker and the page-wide drop target, in plain DOM.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, so metal and gloss in
a file have a world to reflect; `ThemePane`, `LoadingScreen`, and the overlay colours the hint is painted in.

## See also

- [Loading glTF](../assets_gltf/README.md): what a loaded file holds and how to reach its parts.
- [Unload and rebuild](../assets_lifetime/README.md): `destroy()` and `Assets.unload` in depth.
- [Orbit camera](../cameras_orbit/README.md): the orbit's options and limits.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- start_model-viewer` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
