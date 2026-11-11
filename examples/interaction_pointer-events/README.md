# Pointer events

A mesh hears the pointer the way a pixi Sprite does: set its `eventMode` to `'static'`, add listeners with `on(…)`,
and the view casts a ray through the pointer to find the mesh under it. Four clay shapes stand in a row: a pink cube
turning slowly, a purple sphere, an orange torus on its rim and a sky pyramid sliding along a short track at the right.
The pyramid has the same listeners but keeps the default `eventMode`, `'passive'`, so it never runs them until the
pane switches it. Every event is pixi's own with `target3D` added, and the 2D colour menu answers to the same calls.

![Four clay shapes in a row on the light checker floor: a pink cube turned a little, a purple sphere, an orange torus standing on its rim with its hole to the camera, and a sky pyramid to the right; the pane in the top right shows a pyramid folder with eventMode passive, then cursor pointer and an empty Events log](reference.png)

## API

- `Container3D` `eventMode`: `'static'` on the cube, sphere and torus; the pyramid's `'passive'` runs no listeners.
  `'dynamic'` also hears a shape slide under a still pointer, because the view picks again while the pointer rests.
- `Mesh3D` `on(…)`: `pointerover` and `pointerout` swell and settle a shape; `pointertap` hops it for any button but
  the right (`button` 2); `wheel` resizes it by `deltaY` and calls `stopPropagation()` so the `OrbitCamera` doesn't
  zoom too; `contextmenu` calls `preventDefault()` and opens the colour menu at `e.global`.
- `Pointer3DEvent` and `Wheel3DEvent`: pixi's events with the 3D fields added. The log reads `type`, `target3D` (by
  its `label`), a wheel's `deltaY` and a tap's `button`.
- `cursor` over each shape, and `view3d.cursor = 'grab'` wherever no listening mesh is under the pointer.
- `Mesh3D` `hitVolume: 'geometry'`: the torus's hole and the space round the sphere don't count as the shape.
- `View3D` `on('pointerdown')`: the view hears every press on the scene, empty floor included, and closes the menu.
- `OrbitCamera` from `@pixi/3d/extras` with `preventContextMenu: false` and `mouseButtons: { right: 'none' }`, so the
  floor keeps the browser's own menu.
- `Application`, `Graphics`, `Circle`, `FederatedWheelEvent`, `PointData` and `Rectangle` from `pixi.js`. The menu's
  `Graphics` swatches take the same `eventMode`, `cursor` and `pointertap`, each with a `Circle` `hitArea`.

## Controls

- Move over the cube, sphere or torus to swell it; tap or click it to hop it; wheel over it to resize it (over the
  floor the wheel zooms).
- Right-click a shape (long-press on Android; iOS Safari has no context menu) for four clay swatches beside the
  pointer, and tap one to recolour it. A press anywhere on the scene closes the menu.
- Drag to orbit.
- Pane: the `pyramid` folder's `eventMode` picks `passive`, `static` or `dynamic`; with `dynamic`, rest the pointer on
  its track to see it picked as it slides under. `cursor` sets the shapes' cursor, and `Events` logs the last six.

## Files

- `index.ts`: the lesson. Each shape's `eventMode`, `cursor` and listeners, the menu's, the camera and the event log.
- `scene.ts`: the four clay shapes, in one row or two, and the swell, hop, resize and slide the listeners call.
- `menu.ts`: the colour menu, a card of clay swatches beside the pointer.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `fitPortrait`,
`clayGeometry`, `clayMaterial`, `Panel` for the menu's card, `helperColor`, `CLAY` and `THEMES`.

## See also

- [Event propagation](../interaction_event-flow/README.md): capture and bubble, `stopPropagation`, `'none'` and
  `interactiveChildren`.
- [Hit volumes](../interaction_hit-volumes/README.md): the shape each mesh is picked by, and what each costs.
- [Dragging objects](../interaction_drag/README.md): `globalpointermove` and `pointerupoutside` to drag a shape.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- interaction_pointer-events` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
