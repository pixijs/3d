# Tilt shift

A blur that keeps one slab of depth sharp, so a full-size scene reads as a miniature. A clay town round the PixiJS
logo, seen from high up, stays sharp in a band across the middle of the screen, where the logo and the park sit, and
blurs towards the near rows and the far end. The pink bus starts its loop blurred at the near end and drives into focus
as it heads away. The blur goes by depth, not by height on screen: the church spire reaches up among the sharp houses
yet blurs, since it stands nearer the camera than the plane in focus.

![A clay town from above: rows of white houses with coloured roofs either side of a park with pink and lilac trees, the PixiJS logo on a plinth in the middle, all sharp in a band across the middle, with the near rows, the tall spire at the bottom left, the pink bus at the near end of the park and the far rows at the top blurred; the pane in the top right shows TiltShiftEffect enabled, focalDepth 24.0, focalNear 1.5, focalFar 7.0, maxBlur 12.0, debug off and Follow target off](reference.png)

## API

- `TiltShiftEffect` from `@pixi/3d/extras`: blurs the finished frame by each pixel's depth in front of the camera.
  The plane in focus sits `focalDepth` away, starting at `orbit.distance`; within `focalNear` (1.5) of it a pixel
  stays sharp, and past that its blur grows until it reaches `maxBlur` device pixels at `focalFar` (7) from the plane.
  `maxBlur` is scaled by the renderer's resolution so it looks the same on a 2× screen. Every focus setting is a
  uniform write, cheap every frame; `enabled` rebuilds the render graph, fine for a toggle.
- `TiltShiftEffect` `debug`: paints the zones over a grey copy of the frame, a white line on the plane, green in the
  sharp band, orange in front of it and blue behind.
- `FxaaEffect` from `@pixi/3d/extras`: last in `view3d.passes`, after the blur, it smooths edges in the finished frame.
  The scene keeps the canvas's MSAA through post effects, so here it only adds to it.
- `View3D` `passes`: `[tiltShift, new FxaaEffect()]`, run in that order.
- `Spherical` and `setFromSpherical`: the camera's start, 48° down and 18° round from the park's long axis. `DEG_TO_RAD`
  from `pixi.js` turns those degrees into radians.
- `Container3D`, `Mesh3D` and `Geometry3D`: the town and the bus, every piece a clay mesh placed by `addClay` in
  `scene.ts`, its turn and stretch typed from `Mesh3DOptions` and its position a `PointData3D`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, without pan, between 14 and 28 units and 33° to 53° down; its
  `change` event drives `Follow target`.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit, scroll to zoom.
- Pane: the `TiltShiftEffect` folder has `enabled`, `focalDepth` (bring the spire into focus at about 19), `focalNear`,
  `focalFar`, `maxBlur` and `debug`. `Follow target` keeps `focalDepth` on the orbit's target as you zoom, and greys
  out its row.

## Files

- `index.ts`: the lesson. The effect and its settings, the pane, and the focus that follows the target or a resize.
- `scene.ts`: the clay town, rows of houses, the spire, the park's trees and the logo on its plinth.
- `bus.ts`: the pink bus on its loop round the park, the one thing that moves at rest.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its fog pushed past the town, `clayMaterial`,
`clayGeometry`, `roundedBox`, `roundedCylinder`, `loadPixiLogo`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Depth of field](../post_depth-of-field/README.md): a depth blur of your own, and the silhouette smears that
  `TiltShiftEffect` avoids by weighing its taps by depth.
- [Stacking effects](../post_effect-stack/README.md): the tilt shift in a list with other effects, and why order
  matters.
- [Anti-aliasing](../post_antialiasing/README.md): the canvas's MSAA, and what `FxaaEffect` can and can't smooth.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_tilt-shift` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
