# Light types

The four kinds of light, what each one lights and what it costs each frame. A white sun shines one way from above, a
blue `PointLight` drifts over its own pool at the front right, an orange `SpotLight` hangs over a pool at the back
left, and a lilac `AmbientLight` lifts everything else, the logo's shadow included. They're the only light in the
scene and the clay is white, so every hue on it is a light's colour, and switching one off takes away exactly its
share.

![The deep pink PixiJS logo over a lilac-grey checker floor, with three arrows tagged DirectionalLight pointing down at it from the upper left; an orange cone tagged SpotLight lights a white cube and capsule on the left, a blue dot tagged PointLight floats over a white octahedron and sphere on the right inside a blue ring on the floor, and a tag on the logo's shadow reads AmbientLight; the pane in the top right shows Show all, lights in use 3 of 32, shadows 2 maps, and a folder for each light](reference.png)

## API

- `DirectionalLight`: one direction everywhere, set by `lookAt` from its `position`, with `castShadow` on. It shades
  every pixel, and its shadow map draws the shadow casters again.
- `PointLight` with `range`: every way from one point, fading to nothing at `range`. The view shades it only on the
  pixels inside that sphere; a `range` of 0 means no limit. A point light casts no shadow.
- `SpotLight` with `coneAngle`, `penumbra` and `range`: a cone down its local -z, `coneAngle` degrees from its axis to
  its edge, with `penumbra` softening the edge. It casts a shadow here, and the view tests every pixel in its `range`
  sphere against the cone, lit or not.
- `AmbientLight`: the same light on every surface, whatever way it faces, for almost nothing.
- `Light` `color`, `intensity` and `visible`, shared by all four: `color` reads as a pixi `Color`, which
  `setValue` changes in place, and takes any colour on assignment; the view skips a hidden light, so it costs nothing.
- `View3D` `lights`, read with each light's `type` and `canCastShadow` to count the lights in use against
  `MAX_LIGHTS` (32) and the shadow maps drawn. `view3d.environment = null` leaves out the stage's hemisphere fill.
- `Mesh3D`, `Container3D` and `PointData3D`: the white clay under each light.
- `Quaternion` and `Vector3`: the visuals turn the spot's cone outline to the camera and find the logo's shadow.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `Show` picks `all`, one light alone, or `custom` once the folders mix them; `lights in use` and `shadows`
  count what the view shades. The `DirectionalLight`, `PointLight`, `SpotLight` and `AmbientLight` folders each set
  `visible`, `color` and `intensity`, plus the sun's `castShadow`, the point light's `range`, and the spot's
  `coneAngle`, `penumbra` and `castShadow`.

## Files

- `index.ts`: the lesson. The four lights, the switch that shows one alone, and the counts of lights and shadow maps.
- `scene.ts`: the white clay under the spot and round the point light.
- `controls.ts`: the pane, its `Show` row and a folder per light.
- `visuals.ts`: each light's shape and name tag.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false`, `LightHelper` for the
rays, cone and ring, `loadPixiLogo`, `clayGeometry`, `clayMaterial`, `LabelLayer`, `NARROW_BELOW`, `ThemePane`,
`LoadingScreen`, `fitPortrait`, and `BRAND`, `CLAY`, `THEMES` and `themeFromUrl` from the palette.

## See also

- [Many lights](../lighting_many-lights/README.md): dozens of point lights at once, and what each one costs.
- [Environment light](../lighting_environment/README.md): the light from every direction that this example leaves out.
- [Shadows](../shadows_basics/README.md): the sun's and the spot's shadows, and their settings.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- lighting_light-types` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
