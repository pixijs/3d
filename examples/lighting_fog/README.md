# Fog

Distance fog and its three curves: `linear`, `exponential` and `exp2`. Four columns of clay, a puck, a capsule, a cube
and a sphere, run away from the camera into a linear fog, each shape paler with depth until the rows past `far`
vanish. Fog is measured from the camera, so it moves with it, and a `background` of the fog's own colour lets fully
fogged surfaces disappear into the sky with no seam at the horizon.

![Four columns of clay shapes, orange pucks, purple capsules, pink cubes and blue spheres, running back over the lilac checker floor and fading into a pale haze; a line across the floor in front of the first row is tagged fog near and one far back is tagged fog far; the pane in the top right shows a fog folder with type linear, near 15.0, far 65.0 and color 0xf3f1f7, and background 0xf3f1f7](reference.png)

## API

- `View3D` `fog`: takes a `Fog` object and keeps it, so writing its `near`, `far`, `density` or `color` later is free
  and shows on the next frame. Its `type`, a `FogType`, is fixed, so the example holds one object per curve and
  assigns another to switch; a curve's first use compiles new shaders.
- `Fog` `near` and `far` for `linear` fog, where it starts and where it's full; `density` for `exponential` and
  `exp2`, which never reach full. The densities put each exponential curve half way at depth 40, the middle of the
  linear range, so switching changes only the shape.
- `View3D` `background`: a plain colour behind the scene. The `color` row sets it and every fog together; set it apart
  and a seam shows where the fogged floor meets the sky.
- `Mesh3D` and `Container3D`: the 56 shapes, sharing one geometry and one material per column.
- `Matrix4` and `Vector3`: the visuals read the camera's transform to lay each depth line square to its line of sight.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit and scroll to zoom, inside limits that keep the field and the
  lines in view. The camera's `zoom`, not its distance, fits a narrow screen, so the fog on every row stays as it is.
- `Application` and `Rectangle` from `pixi.js`: `Rectangle` holds the view's rect on screen, for placing the tags.

## Controls

- Drag to orbit and scroll to zoom: the lines stay with the camera while the field moves through them.
- Pane: the `fog` folder's `type` picks the curve; `near` and `far` show for `linear`, `density` for `exponential` and
  `exp2`; `color` sets the fog and the background together. `background` sets the sky alone.

## Files

- `index.ts`: the lesson. The three fog objects, the colour that matches them to the sky, and the camera.
- `scene.ts`: the field of clay, and the turn of its cubes.
- `controls.ts`: the pane's `fog` folder and `background` row, and the fade to the new haze on a theme change.
- `visuals.ts`: the lines across the floor at `near` and `far`, or at 50% fog for an exponential curve, worked out
  from the camera each frame.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, whose own fog and sky the lesson replaces;
`clayGeometry`, `clayMaterial`, `ArrowHelper` for the lines, `LabelLayer`, `viewRect`, `ThemePane`, `LoadingScreen`,
and `THEMES`, `mixColor` and `themeFromUrl` from the palette.

## See also

- [Environment light](../lighting_environment/README.md): `background` as a cube map or a gradient, and the light it
  stands apart from.
- [Tone mapping](../lighting_tone-mapping/README.md): the other view settings between light and screen
  colour.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- lighting_fog` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
