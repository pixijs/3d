# Materials per model

Give one `Model3D` materials of its own while the others built from the same `Scene3DSource` keep drawing the
source's. Three Damaged Helmets float in a row, all built from one file. The middle one draws a `clone()` of the
helmet's material with `dissolveBit` added, so it alone is eaten away in holes with glowing edges, while the other two
draw the one shared material and stay whole. A tag over each helmet says which it draws. Take a helmet's dissolve back to 0
and it draws the shared material again, and its copy is destroyed. The idea to leave with: models from one source share
its materials until you give one its own through `materials`, and assigning never destroys what it replaces.

![Three Damaged Helmets floating face on in a row over the light checker floor; the middle one is eaten away in rounded holes with pale yellow edges, the floor's checks showing through, and tagged own copy in pink, while the outer two are whole and tagged shared; the pane in the top right shows a dissolve folder with left 0.00, middle 0.45 and right 0.00](reference.png)

## API

- `Assets.load` from `pixi.js` with `model('gltf.DamagedHelmet')` from the asset manifest: a `Scene3DSource` whose
  `materials` holds the one material the helmet draws.
- `Model3D` with `source`, `x`, `y` and `parent`: three models from one source, each drawing the source's materials
  until it's given its own.
- `model.materials`: read, it lists the material this model draws for each of the source's, and it's
  `source.materials` itself until the model has its own, which is how the tags tell them apart. Assigned a function,
  it calls it once per source material and draws what it returns, switching the meshes at once. Assigned
  `undefined`, it draws the source's again. Assigning never destroys what it replaces, so the example takes its copies
  from the list and destroys them after.
- `clone({ extraBits: [dissolveBit] })` on each of the source's materials: a copy that keeps everything the loader set
  (textures, factors, emissive, alpha mode) and adds the bit. Its `extraBits` say which materials in the list have the
  bit, and `destroy()` frees a copy and leaves the shared textures alive.
- `dissolveBit` from `@pixi/3d/extras`: a shader bit that cuts a surface away with noise, on any material, lit or
  unlit. Its fields join the copy's `material.data`, all at 0 on a new copy: `dissolve` runs from 0, whole, to 1, all
  cut away; `dissolveEdgeColor` is the glow along the cut, in linear light, set once on each copy since black draws
  none; `dissolveHoleSize` stays at 0, which means the default 0.25 units, a handful of holes across a helmet.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with damping and distance and angle limits.
- `Application` from `pixi.js`.

The shadow pass draws casters with its own shader, which a material's extra bits never reach, so a dissolving helmet
would cast a whole shadow. None cast, and the stage's key light renders no shadow map (`stage.key.castShadow = false`).

## Controls

- Drag to orbit.
- Pane: the `dissolve` folder has a row for each helmet, `left`, `middle` and `right`. Moving a row off 0 gives that
  helmet its own copy with the bit and dissolves it; back to 0, it draws the shared material again and the copy is
  destroyed.

## Files

- `index.ts`: the lesson. Three models from one source, the copies with the bit, the switch to them and back, and the
  pane.
- `visuals.ts`: the tag over each helmet, `shared` or `own copy`.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, so the chrome has a
world to mirror; `ThemePane`, `LoadingScreen`, `LabelLayer` and `fitPortrait`, with `THEMES` and `themeFromUrl`.

## See also

- [Loading glTF](../assets_gltf/README.md): several models from one source, and one write to a shared material
  repainting them all.
- [Extra bits](../shaders_extra-bits/README.md): how a shader bit like `dissolveBit` is written.
- [Unload and rebuild](../assets_lifetime/README.md): what a model and its source free when they go.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- assets_model-materials` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
