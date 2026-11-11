# Many views

Many `View3D`s side by side on one pixi stage, each with its own scene and camera. A view is a pixi display object:
`position` places it and `setSize` sizes it, like a sprite, and with no `background` the 2D panel drawn before it shows
round its meshes. The picture shows six product cards, each a view with one clay shape, its own light and its own
`OrbitCamera`, and an overview, one more view that shows the focus card's world from outside with that card's camera
drawn in it. Turning one card's shape or camera changes nothing in the others.

![Six cards in two rows, each a view showing one clay shape on a two-tone panel: a pink cube, a pale pink capsule lying down, a purple pyramid, a lilac puck on its side, a sky octahedron and a pale sky torus; the cube's card is outlined in pink, and the overview card shows the cube from outside with a pink view volume running from a camera tagged camera; the pane in the top right shows Cards 6, Spinning 1 · cube, Focus 1 · cube and camera.fov 40](reference.png)

## API

- A `View3D` per card, with `toneMapping: 'none'`, `environment`, `cull: 'off'` and `cursor: 'grab'`: its own `root`,
  `camera` and scene. `position` and `setSize` place and size it on its panel, and with no `background` the panel shows
  round the shape. Every view renders on its own each frame, so each stays cheap: one light, no shadows, no culling for
  content that always fits.
- `view.camera.fov`: each camera keeps its own, so the `camera.fov` row zooms the focus card alone.
- `DirectionalLight`: one per card, since a light lights only the view it's in.
- `Hemisphere`: one fill that every view shares, since a view only reads it.
- `OrbitCamera` from `@pixi/3d/extras`, one per card, with `enableZoom` and `enablePan` off, a `rotateSpeed`, and polar
  and azimuth limits. Its `start` event moves the focus to its card, `reset()` puts the camera back (but not its fov),
  and `distance` sets how far the overview's view volume runs.
- `orbit.destroy()`, then `view.destroy({ children: true })`: a card that goes takes its shape, light and camera with
  it, but not the kit's shared geometry and material, which other cards still draw.
- `Mesh3D`, `Vector3` and `PointData3D`: each card's product, and the overview's stand-in, which takes the focus card's
  geometry, material and rotation.
- `Container`, `Graphics` and `Rectangle` from `pixi.js`: the panels, all in one container before every view, since a
  view ends pixi's 2D batch; that way the page's 2D draws as one batch. `Application` from `pixi.js`.

## Controls

- Drag a card to orbit its camera; the overview turns to that card, whose panel lights in pink.
- Pane: `Cards` sets how many there are, 1 to 12; `Spinning` picks the card whose shape turns, or `None`; `Focus`
  picks the card the overview shows; `camera.fov` zooms the focus card's camera; `Reset cameras` puts every camera back.

## Files

- `index.ts`: the lesson. A view, light and orbit per card, adding and removing cards, and placing each view.
- `scene.ts`: each card's clay product, and where every panel goes on the page.
- `ViewPanel.ts`: the 2D panel under a view, with its title tag and its focus outline.
- `controls.ts`: the pane's rows.
- `visuals.ts`: the overview's stand-in, its copy of the light, its grid, and the focus camera's view volume.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` on the overview, for the pane's theme switch;
`Panel` and `InsetTitle` under `ViewPanel`; `FrustumHelper`, `GridHelper`, `LabelLayer`, `clayGeometry`,
`clayMaterial`, `ThemePane` and `LoadingScreen`.

## See also

- [View in UI](../2d3d_view-in-ui/README.md): one view in a 2D layout, and how it shares pointer input.
- [Second cameras](../cameras_render-to-texture/README.md): more than one camera on one scene.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- 2d3d_many-views` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
