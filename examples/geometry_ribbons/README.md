# Ribbons

A `RibbonGeometry` draws a line of points as a strip that turns to face the camera, so a line can be any width,
where a `'line-list'` is always 1 px. Two corkscrews run from the front of the floor to the back along the same
points. The pink one's width is in world units, so its far turns thin with distance and it casts a shadow its own
width; the purple one's is in pixels, so it stays 7 px wide on screen from the nearest turn to the farthest. Both
fade from one palette colour to another, a colour per point. The idea to leave with: the CPU builds the strip once
from the points, two vertices each, and the vertex shader turns it to the camera every frame, so orbiting never shows
its edge.

![Two corkscrew ribbons on the light checker floor running away from the camera: on the left a thick lit strip
fading from pink near the camera to orange far away, its turns thinning with distance and its shadow cast on the
floor, tagged widthUnits: 'world'; on the right a thin strip fading from purple to sky blue that stays the same
width all the way back, tagged widthUnits: 'pixels'; the pane shows Theme Light, width (world) 0.14, width (pixels)
7, Taper off, Colours on and Points off](reference.png)

## API

- `RibbonGeometry` from `@pixi/3d`: built from `points`, x, y and z for each, and `width`, one number for every point
  or a `Float32Array` with one per point, which the Taper row passes to swell each ribbon from nothing at its ends.
- `RibbonWidthUnits`, the `widthUnits` option: `'world'` measures `width` in the units of the points, so it scales with the mesh, `'pixels'` in
  pixels on screen at any distance.
- `RibbonGeometry` `colors`: an RGBA colour per point, blended along the line. Vertex colours are linear light, so
  `scene.ts` converts each palette colour with `srgbToLinear` from `@pixi/3d`, after pixi's `Color` splits it into
  red, green and blue.
- `Mesh3D` with `geometry`, `material`, `castShadow` and `parent`: any material draws a ribbon. Widths and colours
  are vertex data, so a pane change builds new geometries, assigns them to each mesh's `geometry` and destroys the
  old ones with `destroy(true)`. The pixel ribbon has `castShadow: false`, since a pixel width means nothing in the
  light's shadow map.
- `createClayMaterial` from the theme kit, with `vertexColors` on so it reads the geometry's `colors`: a lit
  material shades the strip as a round cord.
- `View3D` and its `camera`; `OrbitCamera` from `@pixi/3d/extras` to orbit round the strips and see them turn.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit; scroll to zoom.
- Pane: `width (world)` and `width (pixels)` set each ribbon's `width`; Taper gives each point its own width, thin
  at the ends; Colours fades each ribbon between two palette colours, or keeps it one colour; Points draws a dot at
  every point the pink ribbon runs through.
- The page opens on the light theme unless `?theme=` says otherwise.

## Files

- `index.ts`: the lesson. Both ribbons' geometries, their meshes and material, and the pane.
- `scene.ts`: the corkscrew's points, the tapered widths and the colour gradient.
- `visuals.ts`: the tags naming each ribbon's width units, and the dots on the pink ribbon's points.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `createClayMaterial`, `PointsHelper`,
`LabelLayer`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Lines and points](../geometry_lines-and-points/README.md): the `'line-list'` topology, 1 px wide at any distance.
- [Vertex colours and custom attributes](../geometry_vertex-data/README.md): `colors` and an attribute of your own read
  by a shader bit, which a ribbon takes per point through `pointAttributes`.
- [Shadows](../shadows_basics/README.md): how casting and receiving work.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_ribbons` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
