# Many lights

A view shades up to `MAX_LIGHTS` (32) lights at once, and each light's `range` decides which pixels pay for it. Forty
coloured `PointLight`s fly a slow spiral over a field of white clay spheres, each one tinting the spheres under it.
The view shades the first 32 in the order they joined the scene; the last 8, flying at the field's edge, are ignored
with no warning, so the outer spheres stay grey. Point lights cast no shadows, so they add no draw calls: what they
cost is shading, on the pixels inside their `range`.

![A square field of white clay spheres on a lilac checker floor, seen from high in front, lit in pink, blue, orange and purple pools by small coloured bulbs; eight hollow grey rings mark the lights flying over the outer spheres, one tagged ignored, and a black ring with an arrow tagged range shows one light's reach on the clay; the pane in the top right shows Lights 40, range 1.5, Speed 1.00, Shaded 32 and Per sphere 2.4 lights](reference.png)

## API

- `PointLight` with `color`, `intensity` and `range`: built under `view3d.root`, moved each frame by writing its
  `position`, and switched off with `visible = false`, which keeps its place in the list. The view skips a light on
  every pixel outside its `range`; `range = 0` means no limit, so every pixel shades it.
- `View3D` `lights` and `MAX_LIGHTS`: the view walks `view3d.lights` in the order the lights joined, skips hidden and
  ambient ones, and shades the first 32; a visible light past that is ignored. The visuals walk it the same way to
  mark which lights are ignored.
- `View3D` `environment`: a `Hemisphere` copied from the stage's fill at 0.7 of its `intensity`, so the point lights
  carry the scene.
- `Mesh3D` and `Container3D`: the 121 spheres under the view's `root`, one geometry and one material, so the view
  draws them in one instanced draw.
- `Vector3`: each light's spot on its spiral, written into one vector so the frame loop allocates nothing.
- `Light`: the type the visuals key each light's helper by.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the field.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `Lights` switches on the first 1 to 40; `range` sets every light's reach, 0 for no limit; `Speed` sets how
  fast they fly. `Shaded` reads how many the view shades, and `Per sphere` how many reach the average sphere's top.

## Files

- `index.ts`: the lesson. The 40 lights, switching them on, their range and flight, and the pane.
- `scene.ts`: the field of clay spheres, the spiral each light flies, and the count of lights reaching a sphere.
- `visuals.ts`: a bulb on each shaded light, a hollow ring on each ignored one, and the first light's footprint ring
  and `range` arrow.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false`, so the stage's directional
lights take no places in the list; `LightHelper`, `PointsHelper`, `ArrowHelper`, `LabelLayer`, `clayGeometry`,
`clayMaterial`, `ThemePane`, `LoadingScreen`, `fitPortrait`, and `BRAND`, `THEMES` and `themeFromUrl` from the palette.

## See also

- [Light types](../lighting_light-types/README.md): the four kinds of light, one of each, and what each costs.
- [Environment light](../lighting_environment/README.md): the fill this example turns down.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- lighting_many-lights` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
