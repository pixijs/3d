# Raycast

Picking from your own loop: the ticker calls `view3d.raycast` once a frame through the pointer and fills one reused
hit, so the pick follows the shapes a turntable carries under a still pointer and the loop allocates nothing. Nineteen
clay shapes stand on the turntable, a purple sphere in the middle, six lilac shapes round it and twelve pale sky ones
round those. No pointer has come over the canvas yet, so nothing glows and the pane's `hit` folder reads `null`. Unlike
pointer events, `raycast` picks whatever point you hand it, whenever you call it, and fires no events.

![Nineteen clay shapes on the light checker floor, a purple sphere in the middle, a ring of six lilac shapes round it and a ring of twelve pale sky shapes round those; the pane in the top right shows Reuse hover on, hits created 0, Turntable 0.25 and hitVolume geometry, and a hit folder whose returns row reads null and whose other rows are greyed out](reference.png)

## API

- `View3D` `raycast(position, out)`: casts from the camera through a 2D point, fills `out` with the closest node that
  takes part in picking and returns it; on a miss it returns `null` and leaves `out` as it was. Without `out`, each
  hit is a new object.
- `createRaycastHit3D()`: the one `RaycastHit3D` passed as `out` every frame. The pane shows its `target`, `point`,
  `localPoint` (in the shape's own space), `distance`, `normal`, `uv` and `triangleIndex`.
- `Mesh3D` `eventMode = 'static'` puts the shapes in the pick; the floor keeps `'passive'` and is never hit.
  `hitVolume` `'geometry'` tests every triangle, so a hit carries a `normal`, `uv` and `triangleIndex`; `'box'` tests
  the bounds alone, so they stay zero and -1.
- `View3D` `screenToRay(position, out, true)`: the ray the pick cast, for the side view, which meets the floor's
  `Plane` with `Ray` `intersectPlane` on a miss. `Matrix4` `extractBasis` reads the camera's axes for it.
- `Container3D`: the turntable, turned by `rotation.y`. `Vector3` and `Vector2` hold the hit's values.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit; its `distance` sizes the view volume the side view draws.
- `Application`, `Point` and `Rectangle` from `pixi.js`. The pick casts through `app.renderer.events.pointer.global`,
  the `Point` where pixi last saw the pointer.

## Controls

- Point at a shape, or tap one, and hold still: the shape under the pointer turns pink, a ring marks where the ray
  struck and an arrow stands along the normal (a box frame in `box` mode). The pick follows the shapes the turntable
  carries under the pointer, and the inset "the ray, from the side" appears in the bottom right.
- Drag to orbit.
- Pane: `Reuse hover` hands `raycast` the one hit, and `hits created` counts the new objects made with it off.
  `Turntable` sets the turn in radians a second, and `hitVolume` switches every shape between `geometry` and `box`.
  The `hit` folder shows what `returns` gave (`hover`, `a new object` or `null`) and the last hit, greyed on a miss.

## Files

- `index.ts`: the lesson. The shapes' `eventMode` and `hitVolume`, the pointer, and the `raycast` every frame.
- `scene.ts`: the turntable of nineteen clay shapes, and the glow on the picked one.
- `controls.ts`: the pane, with the last hit's fields as read-only rows.
- `visuals.ts`: the ring at the hit, the normal's arrow and the box frame, and the ray handed to the inset.
- `rayInset.ts`: the side view: the main camera's view volume, the pointer, the pink ray to the hit, and a faint
  dashed line past it into any shape behind.
- `sideCamera.ts`: where the side view's camera stands, and the near plane it cuts at so no shape hides the hit.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `fitPortrait`,
`clayGeometry`, `createClayMaterial` (a `GlowingClayMaterial`), `BRAND`, `CLAY`, `THEMES`, `RingHelper`,
`ArrowHelper`, `BoxHelper`, `InsetView`, `ScreenLines`, `viewRect` and `NARROW_BELOW`.

## See also

- [Hit volumes](../interaction_hit-volumes/README.md): every `hitVolume` choice side by side, and what each costs.
- [Pointer events](../interaction_pointer-events/README.md): the same pick run by pixi's event system.
- [Painting on a mesh](../interaction_paint/README.md): a hit's `uv` and `normal` put to work.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- interaction_raycast` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
