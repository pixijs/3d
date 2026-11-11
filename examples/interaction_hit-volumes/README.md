# Hit volumes

A pointer never touches a mesh's surface: the view casts a ray and tests it against each listening mesh's
`hitVolume`, which needn't be the mesh you see. Four clay shapes float in a row, each with a different volume drawn
round it: a box frame round the orange octahedron, a sphere's outline round the purple sphere, a faint triangle net
over the sky torus, and a cylinder of the example's own round the lilac puck. A one-test shape is cheap but answers in
the empty space round the clay; triangles are exact, but every one is tested once the ray enters their bounding box.

![Four clay shapes floating in a row over the light checker floor: an orange octahedron in a dark box frame, a purple sphere in a sphere outline, a sky torus on its rim under a faint triangle net, and a lilac puck in a cylinder outline; the pane in the top right shows a hitVolume folder with octahedron 'box', sphere Sphere, torus 'geometry' and puck CylinderVolume (yours), and a picked folder whose target reads null](reference.png)

## API

- `Mesh3D` `hitVolume`, a `HitVolume3DInput`: `null` falls back to the bounding box, which `'box'` names; a `Sphere`
  through the farthest vertex is one test, exact for a ball; `'geometry'` tests every triangle, 1,024 on the torus;
  any `Geometry3D`, here the kit's low-detail clay, is tested triangle by triangle; and an `IHitVolume3D` of your own.
- `IHitVolume3D`: `CylinderVolume` gives `boundingRadiusSq`, the sphere the picker checks first, and
  `raycast(localRay, out)`, which gets the ray in the node's own space, fills the `HitResult3D` (`point`, `distance`,
  zero `normal` and `uv`, `triangleIndex` -1) and returns the distance, or -1 for a miss.
- `Mesh3D` `eventMode = 'static'` and `cursor = 'pointer'`: only a listening mesh is ever the target, and the cursor
  shows wherever the ray meets its volume, a box's empty corners included.
- `View3D` `raycast(position, out)` with `createRaycastHit3D()`: the pick pointer events make, every frame at the
  pointer, filling one `RaycastHit3D` or returning `null`. A one-test volume's `triangleIndex` is -1.
- `View3D` `screenToRay`, `Ray` `applyMatrix4` with a `Matrix4` `getInverse`, and `intersectsBox` with `bounds3D`:
  whether the ray is inside a per-triangle volume's bounding box, where the engine tests every triangle.
- `Geometry3D` `positions` size the `Sphere`. `CylinderGeometry` is the cylinder outline's fill, `Camera3D` the camera
  the round outlines face, and `Destroy3DOptions` its `destroy`'s. `Vector3` and `PointData3D` place the shapes.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit.
- `Application`, `Renderer` and `PointData` from `pixi.js`; the pick casts through `app.renderer.events.pointer.global`.

## Controls

- Point at a shape, or tap it: the volume that answers turns pink, a box, sphere or cylinder filling see-through, so a
  hit in a box's empty corner shows. A triangle net darkens while the ray is inside its bounding box, hit or miss.
- Drag to orbit.
- Pane: the `hitVolume` folder's `octahedron`, `sphere`, `torus` and `puck` rows each pick `null (default)`, `'box'`,
  `Sphere`, `'geometry'`, `Geometry3D (low-poly)` or `CylinderVolume (yours)`. The `picked` folder shows the hit's
  `target` and `triangleIndex`.

## Files

- `index.ts`: the lesson. Each shape's `eventMode` and `hitVolume`, the pane, and the `raycast` every frame.
- `CylinderVolume.ts`: a hit shape of your own, an upright capped cylinder as an `IHitVolume3D`.
- `scene.ts`: the four clay shapes, in a row or two rows of two on a narrower screen.
- `visuals.ts`: each volume outlined, pink while it answers, and the net that darkens while the ray is in its box.
- `CylinderHelper.ts`: the cylinder's outline, two rings and the two side edges the camera sees, as a kit `Helper`.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `fitPortrait`,
`clayGeometry` (its `'low'` detail is the stand-in), `clayMaterial`, `THEMES`, `BoxHelper`, `SphereHelper`,
`WireframeHelper`, and `Helper`, `BarsGeometry` and `sharedHelperResource` for the cylinder's outline.

## See also

- [Raycast](../interaction_raycast/README.md): picking from your own loop, and every field a hit carries.
- [Pointer events](../interaction_pointer-events/README.md): listeners on meshes picked by `'geometry'`.
- [Painting on a mesh](../interaction_paint/README.md): why paint needs `'geometry'`: a box hit carries no `uv`.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- interaction_hit-volumes` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
