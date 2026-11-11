# Toon shading

Cel shading in two halves: `ToonMaterial` rounds the light a surface gets into a few flat tones with a highlight disc
and a rim glow on top, and `OutlinePass`, on the view, draws the ink line round every mesh whose material opts in. A
sky sphere under the logo shows four rings of tone, its highlight and its rim light; a clay cube turns on its right,
snapping each face from tone to tone, and a clay torus rocks on its left with no ink, since its material opts out. The
material's values change at run time for the cost of an upload, while the ink's width and colour are compiled into the
pass, so changing them takes a new one.

![A sky blue toon sphere ringed in four flat tones with a pale highlight disc tagged highlight and its upper right edge tagged rim light, all inside a dark purple ink line; on its left an orange clay torus with no ink line, tagged no outline, and on its right an outlined lilac cube; the pink PixiJS logo floats above, outlined too; the pane in the top right shows a ToonMaterial folder with bands 3, specularSize 0.03, rimIntensity 0.50 and rimPower 4.0, and an OutlinePass folder with width 0.040, color 0x6446ab and enabled ticked](reference.png)

## API

- `ToonMaterial` from `@pixi/3d/extras` (`baseColor`, `bands`, `specularSize`, `rimIntensity`, `rimPower`): the
  material half. `bands` is the number of light steps above the unlit tone, so 3 gives four tones; `specularSize` is
  the highlight disc's size; `rimIntensity` is the rim glow's strength, and a higher `rimPower` thins it. At run time
  the values change through `material.data`, uploaded on the next render with no recompile. `outline: false` keeps a
  material out of the ink, as the torus's is. `ToonMaterialOptions` types the shared values.
- `OutlinePass` from `@pixi/3d/extras` (`width`, `color`, `enabled`): the ink half, given to the view in `passes`. It
  redraws each opted-in mesh a little larger and inside out, so only a rim shows round the silhouette; `width` is in
  each mesh's own units. `enabled` flips in place, but `width` and `color` are compiled into its shader, so a change
  puts a new pass in `view3d.passes` and calls `destroy()` on the old one, since the view never destroys a pass it
  drops. `OutlinePassOptions` types its options.
- `DirectionalLight` (`intensity`, `castShadow`, `shadow.normalBias`) and `AmbientLight`: `ToonMaterial` reads only
  direct lights and `AmbientLight`, not the stage's sky fill, so the example brings its own key and ambient.
- `View3D` with `passes`, and an `environment` `Hemisphere` at 1.3 times the stage's fill, to lift the PBR floor
  without the stage's key; its `camera`.
- `Mesh3D` and `SphereGeometry`: the sphere at its true size, since a scaled one would get a thicker line;
  `BaseMaterial3D` and `Container3D` type the props' materials and parent.
- `Matrix4` and `Vector3`: where the highlight and rim tags sit on the sphere, worked out each frame from the light
  and the camera's `getGlobalTransform`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, keeping the lit side in view.
- `Application` and the `PointData` type from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: the `ToonMaterial` folder sets `bands`, `specularSize`, `rimIntensity` and `rimPower` on every toon material;
  the `OutlinePass` folder sets the ink's `width` and `color`, each building a new pass, and turns it on and off with
  `enabled`.

## Files

- `index.ts`: the lesson. The lights, the toon materials, the outline pass and how each value changes at run time.
- `controls.ts`: the pane's two folders, which hand each change to `index.ts`.
- `scene.ts`: the sphere, torus, cube and logo, and their motion.
- `visuals.ts`: the highlight, rim light and no outline tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false`, for the floor, fog and sky
alone; `loadPixiLogo` and its `PixiLogo` type, `clayGeometry`, `ThemePane`, `LoadingScreen`, `LabelLayer` and its
`Label` type, `fitPortrait`, and `BRAND`, `CLAY`, `THEMES`, `mixColor` and `themeFromUrl` from the palette.

## See also

- [Outlines and wireframes](../post_material-passes/README.md): `OutlinePass` moved from mesh to mesh with
  `enablePass`.
- [PBR, Phong and flat](../materials_lighting-models/README.md): the built-in lighting models a toon material sits
  beside.
- [Custom lighting model](../shaders_lighting-model/README.md): a light response of your own.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_toon` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
