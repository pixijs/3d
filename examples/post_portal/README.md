# Portals

A texture portal: a second camera draws the far side into a render texture, and the opening shows it. A clay doorway
on the light floor opens onto a dark world with the PixiJS logo, which is ordinary geometry in the same scene, 30
units under the floor. The far side lines up with the frame and slides past it as you orbit, so it reads as an
opening, not a picture; the card in the corner shows the whole feed, of which the opening is the part behind the door.

![A lilac clay door frame on the light checker floor, its opening showing a dark room with a dark checker floor and the pink PixiJS logo floating in it; a card tagged feed at the bottom right shows the whole feed, the same dark room small, with an empty black strip along its bottom; the pane in the top right shows entry.material PortalMaterial, shape door and exit.angle.y 180](reference.png)

## API

- `PortalPass` from `@pixi/3d/extras`, with `entry`, `exit` and `texture`: each frame the entry is in view, it stands
  its own camera, `portal.camera`, behind `exit` exactly as the view's camera stands before `entry`, and draws the
  scene from there into `texture` before the scene draws. The camera clips away everything on its own side of the
  exit's plane and draws no sky, so part of the feed comes out empty; from behind the door the pass skips, and the
  feed keeps its last picture. It runs as `view3d.passes = [portal]`.
- `PortalMaterial` from `@pixi/3d/extras`, with `texture`: shows the feed on the entry at each pixel's own screen
  position, which is what lines the far side up with the frame.
- `RenderTexture` from `pixi.js`: the feed, made with `RenderTexture.create` at the screen's size and resolution and
  resized on the renderer's `resize` event, since the material maps screen position straight onto it.
- `FlatMaterial`: the poster the pane swaps in, the same feed on the opening's own UVs, so the whole frame rides on
  the door; also the far world's unlit dome and floor, and the feed card's picture.
- `Mesh3D` and `Geometry3D`: the entry and exit, flat fans facing their local +z, one per shape. Only the exit's pose
  counts, turned with `angle` to face its room; setting `entry.geometry` reshapes the opening without touching the pass.
- `Container3D`, `TorusGeometry`, `SphereGeometry` and `PlaneGeometry`, with `Texture` from `pixi.js`: the doorway's
  frames, the far world's dome and the card's picture; the far checks and sky are canvases painted pixel by pixel.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`, whose lens the portal camera borrows every frame.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit all the way round the door, without pan.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit and watch the far side slide past the frame, or walk behind the door; scroll to zoom.
- Pane: `entry.material` swaps `PortalMaterial` for `FlatMaterial`, the feed as a plain picture; `shape` picks the
  `door`, `arch` or `round` opening; `exit.angle.y` turns the exit from 135 to 225, and the far room with it.

## Files

- `index.ts`: the lesson. The feed, the two materials, the entry and exit, the pass and the pane.
- `scene.ts`: the clay doorway, with an opening and a frame for each shape.
- `farWorld.ts`: the world the portal looks into, a dome, a fading checker floor and the logo, always the other theme.
- `visuals.ts`: the card in the corner that shows the whole feed.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayMaterial`, `roundedBox`,
`roundedCylinder`, `loadPixiLogo`, `InsetView` for the card, `ThemePane`, `LoadingScreen`, `fitPortrait`, and
`THEMES` with `mixColor` for the far world's colours.

## See also

- [Second cameras](../cameras_render-to-texture/README.md): a camera drawing into a render texture, without the
  portal's pose.
- [Render graph](../post_render-graph/README.md): passes of your own, the kind `PortalPass` is.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_portal` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
