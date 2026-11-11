# Planar mirror

A mirror built from a second camera: `mirrorCamera` stands as far under the glass as the view's camera stands over
it, through the same lens, and draws the scene into a render texture that the glass shows turned over. Its
`clippingPlane` is the glass, so it skips everything on its own side of the mirror. The picture shows the logo over a
glass panel and its reflection, with a side view of both cameras and the raw feed beside it.

![The pink PixiJS logo floating over a pale blue glass panel on a lilac clay stand, its reflection upside down in the glass; on the right a "from the side" inset shows the camera's frustum over the mirror line and the mirror camera's sky blue frustum under it in a wash tagged clipped, and a "render texture" inset shows the feed, the logo the right way up; the pane shows resolution 1, pixels "all of the screen's", baseColor 0xe7f7fe and clippingPlane ticked](reference.png)

## API

- `Camera3D` built with `renderTexture` and `clippingPlane`: a second camera that draws into a texture rather than
  the view. Each frame it copies the view camera's `fov` and a flipped `viewport`, takes the reflected `position`, and
  `lookAt`s the target's reflection.
- `Plane`: the glass's plane, made with `setFromNormalAndCoplanarPoint`, then moved into the mirror camera's view
  space with `applyMatrix4` and the inverse (`Matrix4` `getInverse`) of `getGlobalTransform`, since `clippingPlane`
  is in the camera's own view space. Setting `clippingPlane` to `null` turns the cut off.
- `RenderTexture` from `pixi.js`: the feed, made with `RenderTexture.create` at the screen's size, `resolution` and
  `dynamic: true`, and kept in step with `resize`.
- `view3d.passes` with `MeshPass`es that name the camera (`'opaque'`, then `'transparent'` with `sort: 'distance'`): a
  second camera draws only through passes that name it.
- `Pass3D`: `SkyPass` subclasses it, running at the `'beforeOpaque'` stage, and its `build` adds a `BackgroundPass`
  to the `RenderGraph` from the `PassContext`'s renderer, so the feed gets the view's sky instead of black.
- `BaseMaterial3D` with a `ShaderBit`: `MirrorMaterial` is unlit (`lit = false`, `fog: false`) and works in display
  space (`colorSpace`, a `ColorSpace`, is `'display'`). Its bit declares a `mirror` texture slot, generating `sampleMirror(uv)`, and reads
  the feed at each pixel's own screen position, flipped, times `baseColor`, through the colour-space helpers
  `decodeFrame` and `inputTint`. `MaterialData` and `MaterialTextures` type its data and texture slots; `Texture` and
  `ColorSource` from `pixi.js` type its options.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit with `enableDamping`, no pan or zoom, the tilt held between
  `minPolarAngle` and `maxPolarAngle`, and `autoUpdate: false` so `update(ticker)` runs before the mirror camera poses.
- `Mesh3D`, `PlaneGeometry`, `Container3D`, `Spherical`, `Vector3` and `PointData3D`: the glass, the stand, the side
  view's props, the camera's start and the subject's outline. `View3D`: the main view.
- `Application`, `DEG_TO_RAD`, `RAD_TO_DEG`, `Rectangle`, `Point` and `Renderer` from `pixi.js`, for the boot and the
  layout; the feed card shows a `Texture` that frames a band of the feed's source.

## Controls

- Drag to orbit, and the side view shows `mirrorCamera` move under the glass as the camera moves over it.
- Pane: `resolution` sets the feed's texels per CSS px, and `pixels` reads out its share of the screen's pixels;
  `baseColor` tints the glass; `clippingPlane` turns the mirror camera's cut at the glass on and off.

## Files

- `index.ts`: the lesson. The feed, the mirror camera and its passes, the glass, the orbit and the pane.
- `MirrorMaterial.ts`: the glass's material and its shader bit.
- `SkyPass.ts`: the pass that draws the background into the feed.
- `scene.ts`: the clay stand under the glass.
- `visuals.ts`: places and updates the side view and the feed card.
- `sideView.ts`: the side view, both cameras' frusta over flat copies of the logo and stand, and the clipped wash.
- `feedCard.ts`: the feed card, the band of the render texture round the glass, the right way up.
- `layout.ts`: fits the lens and the panels to the screen, clear of the subject.
- `subjectOutline.ts`: where the logo and the stand land on screen, for the layout.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `clayMaterial`, `roundedBox`,
`InsetView`, `FrustumHelper`, `ArrowHelper`, `GhostHelper`, `helperMaterial`, the palette, `ThemePane` and
`LoadingScreen`.

## See also

- [Second cameras](../cameras_render-to-texture/README.md): a camera's `renderTexture` and `viewport` without the
  reflection.
- [Clipping planes](../cameras_clipping/README.md): the camera's `near` and `far` planes.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- cameras_mirror` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
