# Dragging objects

Dragging a shape across a surface with `globalpointermove` and `pointerupoutside`. A point on the screen is a whole
line of points in the scene, so a press lays a level `Plane` through the grabbed point, and each move asks
`view3d.screenToWorld` where the pointer's line meets it. The picture shows five clay shapes at rest on a gridded
board; while one is held, a pink sheet marks the drag plane at the grabbed height, with a dot where the line meets it.

![Five clay shapes on a white board ruled in a grid of one-unit squares, on the light checker floor: a lilac puck, a purple sphere and a pale sky pyramid at the back, a sky cube and an orange torus at the front; nothing is held, so no drag plane shows; the pane in the top right shows move event globalpointermove, release outside and stop propagation ticked, snap to grid off and grid step 1](reference.png)

## API

- `Pointer3DEvent` from `pointerdown` on each shape: `e.hit3D.point` is where the shape was grabbed, `e.button` and
  `e.pointerId` keep the drag to one main-button pointer, and `e.stopPropagation()` keeps the `OrbitCamera` still,
  since the view hears the press after the shape does.
- `globalpointermove`, added with `on` to the held shape and taken off with `off` at the drop, arrives on every move
  over the canvas, so the drag goes on when the pointer outruns the shape; `pointermove` only arrives over the shape.
- `pointerup` and `pointerupoutside` on the held shape: the release over it, and the release anywhere else. Without
  `pointerupoutside` a release off the shape goes unheard and the shape follows the pointer until the next click on it.
- `Plane` and `setFromNormalAndCoplanarPoint`: the drag plane, level through the grabbed point, so the shape slides at
  the height it was grabbed. `View3D` `screenToWorld(e.global, plane, out)` writes the pointer's point on it, and
  returns `null` above the horizon, where the line never meets the plane.
- `Vector3` `subtract` and `clamp`: the grab offset keeps the grabbed spot under the pointer, and the clamp keeps the
  shape on the board. Snap to grid rounds the point's x and z.
- `Mesh3D` with `eventMode: 'static'`, `hitVolume: 'geometry'` and `cursor: 'grab'`: each shape takes events and is
  picked by its triangles. A drag sets the shape's and the view's `cursor` to `'grabbing'`, so the hand stays closed
  when the pointer leaves the shape. The board takes no events, so a press on it reaches the view and orbits.
- `Box.fromCenterSize` builds the sheet; `View3D` `worldToScreen` and `Point` from `pixi.js` place its label.
  `PointData3D` types the drag's reach, and `Container3D` the board's parent.
- `OrbitCamera` from `@pixi/3d/extras`: drag the board to orbit, damped, with no pan, stopping 22° above the board.
- `Application` from `pixi.js`.

## Controls

- Drag a shape to slide it over the board. Drag the board or the floor to orbit.
- Pane: `Move event` picks `globalpointermove` or `pointermove`, `Release outside` adds or drops the
  `pointerupoutside` listener, and `Stop propagation` the `stopPropagation()` call; these apply from the next press.
  `Snap to grid` rounds the held shape onto the grid at `Grid step` (1, 0.5 or 0.25), mid-drag too.

## Files

- `index.ts`: the lesson. The shapes' listeners, the drag plane, grab, move and drop, the snap and the pane.
- `scene.ts`: the white clay board and the five shapes' clay, colours and resting spots; nothing here listens.
- `visuals.ts`: the drag plane's sheet and its label, the dot where the pointer meets it, the board's grid, and, while
  snapping, a ghost where the unrounded point would put the held shape.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its fog pushed back past the board,
`clayGeometry`, `clayMaterial` and `roundedBox`, `BoxHelper`, `DotHelper`, `GhostHelper`, `GridHelper`, `LabelLayer`,
`ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Hit volumes](../interaction_hit-volumes/README.md): what `hitVolume: 'geometry'` costs next to a box or a sphere.
- [Event propagation](../interaction_event-flow/README.md): how `stopPropagation()` keeps a press from the view.
- [Pointer events](../interaction_pointer-events/README.md): the rest of the pointer events a mesh can take.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- interaction_drag` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
