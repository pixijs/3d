# Large scenes

A shadow map's texels spread over the ground it covers, so the same 1024 × 1024 texels over more ground give coarser
shadows. A low sun lays long shadows across a road between rows of white clay shapes, with a pink ball weaving down
it, and the road shows each map's texels as a grid in its cascade's colour, a cell every 16 texels. Cascades keep a
texel about the same size on screen near and far; a fixed box is one cheaper map with nothing past it; and a slower
`update` skips redraws a still world never shows.

![A road running away from the camera between rows of white clay shapes and posts, their long shadows lying across it to the left, and a pink ball further down the road, near the far edge of the purple grid; near the camera the road carries a sky blue grid of small cells, then past a sky blue line a purple grid of bigger cells, then past a purple line a faint orange one up to an orange line tagged maxDistance, with the tags cascade 0 and cascade 1 at the right edge and cascade 2 beside the pane, in those colours; the pane in the top right shows Shadow Cascades, cascades 3, maxDistance 60 and update 1](reference.png)

## API

- `DirectionalLight` with `castShadow: true` and `shadow: { cascades, maxDistance }`, aimed with `lookAt`.
- `light.shadow.cascades` (1 to 4) cuts the camera's view into slices by distance, each with its own map, out to
  `maxDistance` (60), which the camera's `far` caps; `lambda`, left at 0.5, shares the distance out.
- `light.shadow.bounds`, a world-space `Box` set by its `min` and `max`: one map over the street. The example clears
  `cascades` to `undefined` first, since with both set cascades win and the engine warns.
- `light.shadow.update` (`LightShadow` is the type of `sun.shadow`): `1` every frame, `4` or `8` every Nth,
  `[1, 2, 4, 8]` a rate per cascade, or `'manual'`, only when `refreshShadows()` asks. The example refreshes after a
  change, and on the orbit's `change` under `'manual'` with cascades, since they follow the camera.
- `View3D` `shadowFilter = 'pcf'`, a phone's filter, and `shadowQuality`, read as a `ShadowQuality` for the map's
  size; `camera` `near` 0.5 and `far` 150, for depth precision 60 m out; `environment` is the sky's fill, a
  `Hemisphere` at 0.7 of the stage fill's `intensity` so shadows read; `worldToScreen` and `screenToWorld` place the
  tags.
- `Mesh3D` and `Container3D`: the avenue. The road has `castShadow: false`, since its shadow would land under itself.
- `Geometry3D` (`dynamic: true`, rewritten in place) and `Material3D` with `baseColorTexture`, `uvTransform`,
  `alphaMode: 'blend'` and `fog: true`: the grid on the road. `Matrix4`, `Vector3`, `Plane` and `Box`: the maps'
  squares and texel sizes, worked out the way the engine's shadow pass places them.
- `OrbitCamera` from `@pixi/3d/extras` with `autoUpdate: false`, updated first in the app's ticker, so the camera,
  the grid and the shadow pass agree each frame.
- `Application`, `Point`, `Texture`, `CompressedSource` and `Matrix` from `pixi.js`: the grid's line texture, whose
  hand-built mip levels keep a line about 2 px wide at any distance, and the UV transform that reads it on one axis.

## Controls

- Drag to orbit.
- Pane: `Shadow` picks `Cascades` or `Fixed box`. The `Cascades` folder sets `cascades` and `maxDistance`, the
  `Fixed box` folder `Box length`, and a change in either folder picks its placement. `update` sets the redraw rate
  (a fixed box has no per-cascade rate), and `Refresh shadows` calls `refreshShadows()`, under `'manual'` only.

## Files

- `index.ts`: the lesson. The sun, its cascades or fixed box, the update rate, and the refresh when the camera moves.
- `scene.ts`: the shapes, posts and road, the ball's weave, and the sun's balance with the sky's fill.
- `controls.ts`: the pane; Tweakpane's `ListInputBindingApi` drops the per-cascade rate for a fixed box.
- `coverage.ts`: where each map lies and its texel size, following the engine's `csmUtils.ts`, which nothing public
  reports.
- `gridPatch.ts`: a patch of grid lines on the road, cut to a map's square, and its line texture.
- `ground.ts`: the straight-line math over the ground for the patches and the cascade lines.
- `visuals.ts`: a grid per cascade, the line where each ends, the fixed box's frame, and the `cascade 0` to
  `cascade 3`, `maxDistance` and `bounds` tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false` and a wider floor and fog;
`clayMaterial`, `clayGeometry`, `CLAY_SHAPES`, `roundedBox`, `roundedCylinder`, `ThemePane`, `LoadingScreen`,
`fitPortrait`, `ArrowHelper`, `BoxHelper`, `LabelLayer`, `Label`, `flatOptions`, `upNormals`, `helperColor`, and the
palette's `BRAND`, `CLAY`, `THEMES`, `mixColor` and `screenColor`.

## See also

- [Shadows](../shadows_basics/README.md): the flags, the map's size and filter, and the biases, on one map.
- [Fog](../lighting_fog/README.md): the haze the far end of the avenue melts into.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- shadows_large-scenes` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
