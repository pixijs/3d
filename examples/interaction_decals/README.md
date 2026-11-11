# Stamp, fade, reuse

Marks stamped where the pointer hits a surface, from a fixed pool of six planes that fade and get reused. A click on
the tablet reads `hit3D.point` and moves the next slot's plane there, and each stamp dims the others one step, so the
faintest mark is the next to move and nothing is allocated after load. The picture opens on a full pool, faintest on
the left to newest in front, ringed where the next stamp lands. These are flat stamps, not projected decals.

![A purple clay drawing tablet on the light checker floor, its ruled paper face holding six star-cut seals in pink, purple, sky and orange at six opacities, from a faint pink one on the left to a solid pink one at the front left inside a pink ring that marks where the next stamp lands; the pane in the top right shows next size 1.60, next slot 0 and a clear board button](reference.png)

## API

- `Pointer3DEvent` from `pointermove` and `pointerdown` on the tablet's face: `e.hit3D.point` is the world-space spot
  under the pointer, `e.button` keeps stamping to the main button, and `e.stopPropagation()` keeps the `OrbitCamera`
  still, so a stamp doesn't also start an orbit.
- `Mesh3D` with `eventMode: 'static'`, `hitVolume: 'geometry'` and `cursor: 'crosshair'`: the tablet's face is the
  one node that takes events, picked by its triangles so a hit lands on the plane. The marks are `eventMode: 'none'`,
  so a click on one still reaches the tablet under it.
- `Material3D` with `baseColorTexture`, `baseColor` and `alphaMode: 'blend'`: each mark has its own material over one
  shared star texture, so writing its `alpha` fades it alone, with no rebuild. Blended meshes draw back to front, so
  where two marks overlap the nearer one shows on top, even when it's older.
- `PlaneGeometry` with `flipV`: one unit plane the six marks share. A stamp sets its slot's `position`, `scale` and
  `visible`; `Clear board` hides all six.
- `Vector3` and `PointData3D`: the aim point, held in from the tablet's edges so the next mark stays on the paper.
- `View3D`, and `Container3D`, the parent the tablet's clay frame is built under.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, damped, with no pan and tight angle limits.
- `Application`, `CanvasSource` and `Texture` from `pixi.js`: the seal and the ruled paper, drawn once to canvases.

## Controls

- Click or tap the tablet to stamp; over it, the pink ring follows the pointer, as wide as the next stamp. Drag off
  it to orbit.
- Pane: `Next size` sets the next mark's width and the ring's, `Next slot` shows which of the six slots the next
  stamp takes, and `Clear board` hides every mark.

## Files

- `index.ts`: the lesson. The tablet's face and its events, the pool of six marks, the stamp and fade, and the pane.
- `scene.ts`: the tablet's two clay slabs, its ruled paper texture, and `SURFACE`, the face's size and height.
- `stampTexture.ts`: the star seal texture every mark shares.
- `visuals.ts`: the ring at the aim point.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its fog pushed back past the tablet,
`RingHelper`, `clayMaterial` and `roundedBox` for the frame, the palette's `BRAND` colours for the marks, `ThemePane`,
`LoadingScreen` and `fitPortrait`.

## See also

- [Painting on a mesh](../interaction_paint/README.md): paint into a texture at the hit's `uv`, on a curved surface.
- [Pointer events](../interaction_pointer-events/README.md): the pointer events a mesh can take.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- interaction_decals` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
