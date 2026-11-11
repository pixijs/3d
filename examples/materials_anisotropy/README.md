# Anisotropy

Highlights stretched along one direction on the surface, the look of brushed metal. A steel sphere built with the
`anisotropy` group draws its highlight as a long streak; the mesh's tangents say which way the grain runs, and
`rotation` turns the streak away from them. At the highlight an arrow draws the tangent and an arc the rotation, and a
small twin built without the group keeps the round highlight the streak starts from.

![A large steel sphere over the light checker floor with a white highlight streaked diagonally across it; at the top of the streak a sky-blue arrow tagged tangent points left along the sphere's tangent and a short pink arc tagged rotation turns up from it; a small steel twin on the lower left, tagged no anisotropy, shows a round highlight; the pane in the top right shows the anisotropy folder with strength 1.00 and rotation 0.79, and roughness 0.30](reference.png)

## API

- `Material3D` with its `anisotropy` group (`strength`, `rotation`): passing the group at construction builds the
  stretch into the shader, and `material.anisotropy` is then its runtime `AnisotropyProps`, whose values change
  without a rebuild. `strength` sets how far the highlight and reflections stretch, and `rotation` turns the direction
  in radians from the mesh's tangent. A material built without the group, like the twin's, pays nothing for it, and
  its `anisotropy` is `undefined`.
- `Material3D` `baseColor`, `metallic` and `roughness`: the steel under the stretch. The pane's `roughness` sets both
  spheres, so they differ only by the group.
- `SphereGeometry` with `tangents`: four floats a vertex from `sphereTangents`, running round the sphere the way u
  grows, so the grain follows a direction you choose rather than the UV layout.
- `Mesh3D`: the sphere and its scaled-down twin, sharing the geometry; a material without the group never reads the
  tangents.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`. With `Vector3`, `Matrix4` and `worldToScreen`,
  `visuals.ts` finds where the key light's highlight peaks and lays the arrow and arc there, in the tangent plane.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept low and in front, where the highlight stays clear of the
  poles and the silhouette.
- `Application`, `Point` and `Rectangle` from `pixi.js`: the app, and the screen points and tag boxes the labels
  are placed with.

## Controls

- Drag to orbit.
- Pane: the `anisotropy` folder sets `strength` and `rotation` (0 to π); `roughness` sets both spheres' roughness.

## Files

- `index.ts`: the lesson. The steel, the sphere with its tangents, the plain twin and the pane.
- `scene.ts`: `sphereTangents`, the tangents for a `SphereGeometry` grid.
- `visuals.ts`: the tangent arrow and rotation arc at the highlight, and the tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` lit by `loadReflections()`, with `form: false`
so the dark theme draws one streak; `ArrowHelper` and `AngleHelper` for the tangent and rotation; `mixColor`,
`ThemePane`, `LoadingScreen`, `LabelLayer` and `fitPortrait`.

## See also

- [Clearcoat](../materials_clearcoat/README.md): a clear lacquer laid over a material's base, with its own roughness.
- [Metal and roughness](../materials_pbr/README.md): the base layer's `metallic` and `roughness` on their own.
- [Tangent space](../geometry_tangent-space/README.md): what a tangent's four floats mean, and why its w matters.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_anisotropy` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
