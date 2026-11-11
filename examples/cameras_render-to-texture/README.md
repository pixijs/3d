# Second cameras

Any camera in the view's scene can draw it again, but only while a pass in `view3d.passes` names it. Give that camera a
`renderTexture` and its picture lands in the texture instead of on screen, and the texture is an ordinary pixi texture:
a material shows it on a mesh, and a `Sprite` shows it in 2D. The picture shows a security camera on a pole filming a
clay yard onto a monitor, its view volume drawn down to the floor, with a top-down minimap in the corner. Split screen
narrows the view's own camera with `viewport` and fills the other half with a third camera's texture.

![A clay yard with a blue cube, a torus on a white puck, a red capsule walker and a pyramid; a clay security camera on a pole, tagged security camera, aims down at it, its view volume drawn as pink lines to a tinted footprint on the floor, and a purple-framed monitor on the left shows its picture of the cube, the walker and the torus; a "map camera" minimap bottom right shows the yard from straight above; the pane shows split screen off, position.x -1.00, position.y 3.80, feed size 320 × 240 and feedPass ticked](reference.png)

## API

- `Camera3D` with `renderTexture`: the security camera (`fov`, `near` and `far`, a `position`, a clay head among its
  `children`, aimed once with `lookAt`), a map camera with `mode: 'orthographic'` and `orthographicSize` looking
  straight down, and player two, a child of the walker so it turns with it. Each projection takes its texture's
  aspect.
- `MeshPass` with `name: 'opaque'` and a `camera`: one per second camera, listed in `view3d.passes`. A camera draws
  only while a pass names it, and a pass's `enabled` turns that camera off. See-through meshes would need a second
  pass with `name: 'transparent'` and `sort: 'distance'`.
- `RenderTexture` from `pixi.js`: `RenderTexture.create` makes each feed. The security feed is 320 × 240 at
  `resolution: 1`; the map and player two draw at two texels per px or more, since a texture made without `antialias`
  draws without multisampling, and are `dynamic` so a `Sprite` follows their `resize`.
- `FlatMaterial` with `baseColorTexture: feed` and `fog: false`: the monitor's screen, unlit, so it shows the picture
  exactly as the camera drew it. A render texture stores its rows top-down, so the kit's monitor takes `flipV: true`.
- `Sprite` from `pixi.js`: the minimap and player two's half of a split, each with `eventMode: 'static'` so a drag
  on it doesn't orbit the view.
- `view3d.camera.viewport`: the rect of the view the main camera fills, set to one half for split screen.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit with `enableDamping`, no pan, and distance and tilt limits.
- `Container3D`, `Mesh3D`, `Geometry3D`, `Container3DOptions` and `PointData3D`: the clay yard, the walker, and the
  camera's head and post. `View3D`: the main view. `Application` and `Rectangle` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: split screen splits the screen between player one, which you orbit, and player two, riding behind the walker;
  `position.x` and `position.y` move the security camera, and its post follows; feed size resizes its texture, so the
  monitor goes soft; feedPass turns its pass off, so the monitor holds its last picture, and disables feed size
  until it's back on.

## Files

- `index.ts`: the lesson. The three second cameras, their textures and passes, the monitor, the minimap and split
  screen.
- `controls.ts`: the pane.
- `scene.ts`: the clay yard, the walker that laps it, and the security camera's head and post.
- `visuals.ts`: the security camera's view volume and footprint, the minimap's frame and title, and the split's
  divider and player names.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `createMonitor`, `clayMaterial`, `clayGeometry`,
`roundedBox`, `roundedCylinder`, `FrustumHelper`, `LabelLayer`, `Panel`, `ScreenLines`, `viewRect`, `fitPortrait`,
`ThemePane` and `LoadingScreen`.

## See also

- [Planar mirror](../cameras_mirror/README.md): a second camera with a `clippingPlane`, whose texture a custom
  material reads at each pixel's screen position.
- [Perspective and orthographic](../cameras_projection/README.md): the projection settings these cameras take.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- cameras_render-to-texture` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
