# glTF scenes

Loading a glTF file's own scenes, cameras and lights, and switching between them. `diorama.gltf`, made for this example
and loaded from the asset mirror as `model('pixijs.Diorama')`, holds a round stand of three toys
under two scenes, `Sunlit` with a warm sun and `Lamplit` with an orange spotlight and a sky bulb, and three cameras:
`Wide` and `Close` in perspective and `Iso` orthographic. The view looks through the file's `Wide` camera in the sunlit
scene, and an inset in the corner shows the stand from outside, with each camera's view volume and the sun's rays where
the file put them. A file's cameras are `Camera3D` nodes you look through, and its lights light the view as soon as the
model joins it.

![A blue ball, a red ring and a purple pill on a pale round stand, lit warm from the upper left with shadows falling right, on a checker floor tinted by the sun; an inset in the bottom right titled seen from outside shows the stand small with three sun rays above it and camera glyphs tagged Iso, Close and Wide, the Wide one in pink; the pane in the top right shows scene Sunlit, camera Wide and castShadow ticked](reference.png)

## API

- `Object.keys(source.scene)` lists the file's scenes (`['Sunlit', 'Lamplit']`), and `new Model3D({ source, scene })`
  builds one. The two models share the source's geometry and materials, so each costs only its nodes.
- `model.cameras`: the file's cameras as `Camera3D` nodes, with its `fov` or `orthographicSize`, in file order.
  `view3d.camera = model.cameras[i]` looks through one; the camera's model has to be in the view first, so `showShot`
  adds the new model, switches the camera, then removes the old model with `removeChild`.
- `camera.mode` and `camera.zoom`: the loader drops a camera's aspect ratio, so the view's shape sets it, and on a view
  taller than wide `fitFileCameras` zooms the perspective cameras out and the orthographic one in.
- `Light`, `DirectionalLight`, `SpotLight` and `PointLight`: the file's `KHR_lights_punctual` lights load as light
  nodes at the top of each scene. They join `view3d.lights` with their model and leave with it, and cast no shadow
  until `castShadow` is set; a point light can't cast, so `light.type !== 'point'` picks the ones that can.
- `View3D` `environment`: a `Hemisphere` copied from the stage's fill at 0.4 of its `intensity`, so the file's lights
  carry the picture.
- `getLocalBounds()`, `getChildByLabel(label, true)`, `getGlobalPosition()`, `getGlobalTransform()`, `Matrix4`
  (`decompose`), `Spherical`, `Vector3`, `Container3D` and `PointData3D`: the inset frames the stand, the cameras and
  the lights, and a stand-in `Camera3D` draws `Iso`'s box at a size the inset can hold.
- `Application`, `Assets` (loads the `Scene3DSource`) and `PointData` from `pixi.js`.

## Controls

- No orbit: the view is always one of the file's cameras.
- Pane: `scene` (Sunlit, Lamplit), `camera` (Wide, Close, Iso, the names the file gives them), and `castShadow` for
  every file light that can cast.

## Files

- `index.ts`: the lesson. One model per scene, looking through the file's cameras, fitting them to the view, and the
  lights' shadows.
- `visuals.ts`: the inset, each camera's view volume and name, and each light's shape, drawn in the inset's pass only
  so the main view stays what the file's camera sees.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false`, since the file brings its
own; `InsetView`, `FrustumHelper`, `LightHelper`, `ThemePane` and `LoadingScreen`, with `THEMES` and `themeFromUrl`.

## See also

- [Loading glTF](../assets_gltf/README.md): one file, several models, and a shared material.
- [Light types](../lighting_light-types/README.md): the directional, spot and point lights a file's lights load as.
- [Second cameras](../cameras_render-to-texture/README.md): more than one camera on one scene.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- assets_gltf-scenes` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
