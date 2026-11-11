# Orbit camera

`OrbitCamera` keeps the view's camera on a sphere round a `target`: a drag changes its `azimuthAngle` and
`polarAngle`, a zoom its `distance`, and a pan moves the target. Damping lets it glide after you let go, limits keep it
inside a band, `saveState()` and `reset()` store and restore a pose, and its `'change'` event says when a frame is
worth drawing, so the page draws only when the camera moves. The picture shows the logo from a three-quarter view, with
an inset that shows the camera from outside, on its band of the sphere.

![The pink PixiJS logo floating over the light checker floor, a target tag on a leader line at its centre; an inset bottom right titled "the camera, seen from outside" shows a see-through dome round a small copy of the logo, the camera's glyph on its edge with a line to the target, and arcs tagged polarAngle and azimuthAngle and a line tagged distance; the pane shows enableDamping and zoomToCursor ticked, dampingFactor 0.05, autoRotate off, render on demand enabled and frames / s 1](reference.png)

## API

- `OrbitCamera` from `@pixi/3d/extras`, built with `view` and `target`, `enableDamping` and `dampingFactor` (a share
  of the remaining turn applied each update), `minDistance` and `maxDistance`, `minPolarAngle` and `maxPolarAngle`,
  `autoRotateSpeed` in turns a minute, `zoomToCursor`, and the default `mouseButtons` and `touches` written out.
- `OrbitCamera` at runtime: `minAzimuthAngle` and `maxAzimuthAngle` limit the turn only while both are finite;
  `polarAngle`, `azimuthAngle` and `distance` read where the camera stands; `autoRotate` circles on its own;
  `saveState()` stores the pose and `reset()` returns to it.
- `OrbitCamera` events: `'start'` and `'end'` bracket a gesture and swap the cursor; `'change'` fires on every update
  that moves the camera, glides and auto-rotate included, which is all render on demand needs.
- `Ticker` from `pixi.js`: the app's ticker never starts, and a frame function on `Ticker.shared`, after the orbit's
  own higher-priority update, calls `app.render()` only when a frame was asked for.
- `Spherical`: the camera's start, through `position.setFromSpherical`, and the inset's view. `View3D`: the main view,
  sized by hand with `setSize` so a drawn-on-demand frame never lags a resize.
- The inset's own scene: `DirectionalLight` and `AmbientLight` light a copy of the logo; `Vector3`, `Quaternion` and
  `Container3D` place the marks; `SphereBandHelper` builds the band from a `Geometry3D` on a `Mesh3D` and frees it in
  `destroy` with `Destroy3DOptions`.
- `Application`, `Rectangle`, `Bounds` and `Point` from `pixi.js`, the last three for laying out the inset's tags.

## Controls

- Drag to orbit; right-drag, or two fingers, to pan; wheel or pinch to zoom toward the pointer.
- Pane: `enableDamping`, `dampingFactor`, `autoRotate` and `zoomToCursor`. The camera folder reads `polarAngle`,
  `azimuthAngle` and `distance`; the limits folder sets `minDistance`, `maxDistance`, `minPolarAngle`, `maxPolarAngle`
  and azimuth, which turns the ±45° azimuth limits on. The render on demand folder has enabled and a frames / s count,
  which falls to 0 while nothing moves. Save pose and Reset to saved pose store and restore the camera.

## Files

- `index.ts`: the lesson. The orbit, its events and the frame loop that draws on demand.
- `controls.ts`: the pane, bound to the orbit's own properties, and the frame counter.
- `visuals.ts`: the target tag and the inset, its layout and its lit copy of the logo.
- `orbitMarks.ts`: the inset's marks: the band, the two angles, the distance, the camera's glyph and the saved pose.
- `insetTags.ts`: places the inset's tags beside their marks, clear of each other.
- `SphereBandHelper.ts`: the see-through band of a sphere that the orbit's limits leave open.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `fitPortrait`, `InsetView`,
`LabelLayer`, `AngleHelper`, `ArrowHelper`, `FrustumHelper`, `PathHelper`, `Helper`, `ThemePane` and `LoadingScreen`.

## See also

- [First-person camera](../cameras_first-person/README.md): the other camera controller, walking with a free look.
- [Perspective and orthographic](../cameras_projection/README.md): the camera's lens rather than where it stands.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- cameras_orbit` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
