# Event propagation

How a press travels through the scene graph: in through each container to the node it's for, then back out to the
View, the same capture and bubble as pixi's 2D events. A `stopPropagation()` anywhere on the way ends the trip there,
so nothing after it hears the press, the View's `OrbitCamera` included. The picture shows the nested props before any
press: a lilac coffee table holding a sky tray, with a purple cube and an orange ball on the tray.

![A lilac clay coffee table on the light checker floor, holding a sky-blue tray with a purple cube on its left and an orange ball on its right; no press has landed, so no boxes frame anything; the pane in the top right shows stopPropagation() at tray in the bubble phase, the tray's eventMode static with interactiveChildren ticked, and a latest press log reading press the cube, ball or table](reference.png)

## API

- `pointerdowncapture` and `pointerdown`, added with `on` to the table, the tray, the cube and the ball: capture
  listeners run from the outside in, then the target's own, then `pointerdown` from the inside out, and the View's
  last. One listener, `hear`, logs each node; a capture listener also runs at the target, so it checks `eventPhase`.
- `Pointer3DEvent` `eventPhase` against `CAPTURING_PHASE` (1), `AT_TARGET` (2) and `BUBBLING_PHASE` (3): which leg of
  the trip a listener runs in. `e.target3D` is the node the press is for, the same on every hop; `e.currentTarget3D`
  is the node whose listener is running, and `null` in the View's own listeners.
- `e.stopPropagation()`: the listener the pane picks calls it, and nothing after it hears the press, the View
  included, so a drag from a stopped press leaves the camera still.
- `Container3D` `eventMode`: the table, the tray and the cube are `'static'` and run listeners. Every other node keeps
  `'passive'`: the ball, the table's top and its legs hand their hits to the nearest interactive ancestor, so a press
  on the ball is the tray's. `'none'` takes a node and everything under it out of picking.
- `Container3D` `interactiveChildren`: `false` on the tray takes the cube and the ball out of picking but leaves the
  tray, so a press on either lands on the tray's plate behind them.
- `Container3D` `label`, which the log prints, and `cursor`. The table is a plain group with no shape of its own.
- `View3D` `on('pointerdowncapture')` counts every press before it enters the scene; `on('pointerdown')` runs after
  the 3D trip, where `eventPhase` reads `AT_TARGET` since the View is pixi's 2D target.
- `Mesh3D`, and its geometry's `bounds3D` as a `Box`: the props, and the box each frame draws round them.
- `OrbitCamera` from `@pixi/3d/extras`: drag the floor, or any press nobody stops, to orbit.
- `Application` from `pixi.js`.

## Controls

- Press the cube, the ball, the tray or the table. A box frames each node whose listener ran: accent round the
  target, ink round the ancestors, and filled round the one that called `stopPropagation()`. Drag from a stopped press
  and the camera stays still; drag the floor to orbit.
- Pane: the `stopPropagation()` folder sets `at` (nobody, table, tray or cube) and `phase` (capture or bubble). The
  `tray` folder sets the tray's `eventMode` and `interactiveChildren`. A change in either clears the latest press. The
  `Latest press` folder shows its `target3D` and a log of each listener's `eventPhase` and `currentTarget3D` in the
  order they ran, the View's last.

## Files

- `index.ts`: the lesson. Who listens, the one listener that logs and stops, the View's listeners and the camera.
- `scene.ts`: the table group with its top and legs, the tray, and the cube and ball on it; no `eventMode` is set here.
- `trip.ts`: the record of the latest press, its hops and the log the pane prints.
- `controls.ts`: the pane's three folders.
- `visuals.ts`: the box round each node whose listener ran.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry`, `clayMaterial`, `roundedBox`
and `roundedCylinder`, `BoxHelper`, `ThemePane` with a multi-line log, `LoadingScreen` and `fitPortrait`.

## See also

- [Pointer events](../interaction_pointer-events/README.md): the events a mesh can take, before they travel.
- [Dragging objects](../interaction_drag/README.md): `stopPropagation()` on a press that starts a drag.
- [Parents and children](../scene_hierarchy/README.md): the scene graph the press travels through.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- interaction_event-flow` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
