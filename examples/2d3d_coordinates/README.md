# Screen and world

Crossing between pixi's 2D screen, pixels with y running down, and the 3D world, units with y running up, in both
directions. Every frame `view3d.worldToScreen` pins a plain pixi `Text` name tag over each clay piece; the other way, a
screen point is a ray from the camera, and `view3d.screenToWorld` finds where it meets the floor, so a tap drops a shape
there. The picture shows the tagged pieces, the ring where the pointer aims, and a side view of the camera with the
screen as a card in front of it, the pointer's ray going out through the card and the pyramid's line coming back.

![Clay pieces on the light checker floor, a cube, sphere, torus and pyramid in a row and a pink puck in front, each with a white name tag on a short stem; a pink ring on the floor marks where the pointer aims, and a side view panel in the bottom right shows the camera, a card tagged screen, a pink ray from the camera through the card to the ring, and a line from the pyramid back through the card; the pane shows tag.pivot.y 14, pyramid tag (826, 321), pointer (640, 548), drop on floor and aims at (0.00, 0.00, 3.60)](reference.png)

## API

- `view3d.worldToScreen(point, out)`: projects a point in `view3d.root`'s space to global pixels, written straight into
  a tag's `position`. It returns `null` only for a point behind the camera, never for one off the screen's edge.
- `toGlobal(point, out)` on a piece's `Container3D`: takes the point over its top into the world first.
- `view3d.screenToRay(e.global, ray)`: the `Ray` from the camera through a pixel. `ray.intersectPlane(plane, out)` is
  where it meets the floor, a `Plane` with a `Vector3` normal, or `null`; `ray.at(distance, out)` is the point that far
  along it. `view3d.screenToWorld(screen, plane, out)` and `view3d.screenToWorld(screen, distance, out)` take both
  steps in one call.
- `pointermove`, `pointerdown` and `pointertap` on the `View3D`, each a `FederatedPointerEvent` from `pixi.js` whose
  `global` is the pointer in pixels. A press that moved more than a few pixels is an orbit drag and drops nothing.
- `Mesh3D` and its geometry's `bounds3D` stand each piece on a root at its base; `Box.fromCenterSize` gives the key
  light a fixed `shadow.bounds`; `Spherical` places the side view's camera; `PointData3D` types the points.
- `OrbitCamera` from `@pixi/3d/extras`, with `autoUpdate: false`: it moves first in the tick, so the tags project
  through the camera the frame draws with.
- `Text` and `TextStyleOptions` from `pixi.js`: the name tags, lifted by `pivot.y`, in a `Container` that stays at the
  stage's origin, so its own pixels are global pixels. `Point`, `PointData` and `Application` from `pixi.js`.

## Controls

- Move the pointer over the floor to aim, tap to drop a shape there (three at most; the oldest goes), drag to orbit.
- Pane, `world to screen`: `tag.pivot.y` lifts the tags off their pins; `pyramid tag` reads the pixel the pyramid's tag
  sits on. `screen to world`: `pointer` reads the pointer's pixel; `drop on` picks the `floor` or a `distance` along
  the ray, which the `distance` row sets; `aims at` reads the world point, or `none` when the ray misses the floor;
  `Clear shapes` takes the dropped shapes away.

## Files

- `index.ts`: the lesson. The tags, the pointer's ray, the drop, and both crossings each frame.
- `scene.ts`: the clay pieces and their motion, the placer that keeps three dropped pieces, and the tap.
- `controls.ts`: the pane's two folders.
- `visuals.ts`: the pins under the tags, the ring where the pointer aims, and the side view.
- `sideView.ts`: the side view's drawing: the main camera, the screen card, the pointer's ray and the pyramid's line.
- `sideCamera.ts`: where the side view's camera stands and how big its picture is.

From the theme kit (`examples/shared/theme/README.md`): `InsetView` for the side view, `FrustumHelper`, `ArrowHelper`,
`AngleHelper`, `DotHelper`, `RingHelper`, `ScreenLines`, `clayGeometry`, `clayMaterial`, `ThemeStage`, `ThemePane`,
`LoadingScreen` and `fitPortrait`.

## See also

- [Raycast](../interaction_raycast/README.md): picking meshes along a ray from your own loop.
- [Pointer events](../interaction_pointer-events/README.md): pixi's events on 3D meshes, with no ray maths.
- [Perspective and orthographic](../cameras_projection/README.md): the projection both crossings run through.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- 2d3d_coordinates` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
