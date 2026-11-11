# Clipping planes

A camera draws only what lies between its near and far clipping planes, two distances down its view direction. Four
spheres sit 7, 10, 14 and 18 units from a fixed camera, and both planes sweep back and forth through them, cutting each
sphere and the floor at its distance. A cut leaves no cap and the sphere's inside faces aren't drawn, so the picture
opens with near cutting the 7 unit sphere into a ring you see through, and far leaving the 18 unit sphere out. The
light draws shadows from its own view, so a cut sphere still casts a whole shadow. Keep `near` as large and `far` as
small as the scene allows: depth precision bunches up just past `near`.

![Four spheres receding from the camera over a band of checker floor, tagged 7, 10, 14 and 18 units; near has cut the front off the pink 7 unit sphere, leaving a ring you see straight through, the blue and orange spheres are whole, far has left the 18 unit sphere out so only its tag shows, and the floor shows only between the two planes; the pane shows near 6.5, far 17.0 and Sweep ticked](reference.png)

## API

- `view3d.camera`'s `near` and `far`: the distances to the near and far clipping planes, in world units. The pane
  writes them straight to the camera, and the sweep moves them every frame; the view rebuilds the projection from them
  each frame, so a change shows at once.
- The camera's `fov`, widened on a portrait screen instead of moving the camera, so the labelled distances hold; and
  its `position` and `lookAt`, which set the view direction the distances run down.
- `Material3D` (`baseColor`, `roughness`): single-sided by default, so a clipped sphere's back faces are culled and
  the cut shows as a hollow ring.
- `Mesh3D` and `SphereGeometry`: the four spheres, sharing one geometry, built with `position` and `parent`.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `Application` from `pixi.js`.

## Controls

- No pointer controls; the camera stays put so the labelled distances hold.
- The planes sweep on their own, because watching a plane cut through the scene is the lesson. Pane: `near` and `far`
  set the planes; moving either one, or unticking Sweep, pauses the sweep, and ticking Sweep again glides the planes
  back into it.

## Files

- `index.ts`: the lesson. The spheres, the camera, the pane and the sweep.
- `visuals.ts`: the distance tag over each sphere, which stays when its sphere is clipped away.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `LabelLayer` and
the `BRAND` palette.

## See also

- [Perspective and orthographic](../cameras_projection/README.md): the rest of a camera's projection, `fov`, `zoom`
  and the orthographic mode.
- [Planar mirror](../cameras_mirror/README.md): a camera's `clippingPlane`, a third clip plane at any angle.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- cameras_clipping` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
