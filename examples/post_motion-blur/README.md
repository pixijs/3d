# Motion blur

`MotionBlurEffect` streaks each pixel along the way its surface moved on screen since the camera's last render, and
only the camera's motion counts. The camera circles the PixiJS logo by itself inside a ring of clay posts: the posts
nearest its path sweep across the screen fastest and leave long coloured streaks, the far posts and the far floor
drift the other way, and the logo at the orbit's centre barely moves on screen, so it stays nearly sharp. A clay top
spins fast beside the logo, yet its spin never smears, since objects count as still. The inset at the bottom right
draws the same scene through a `VelocityViewer`, the velocity the blur follows: red where the floor and the near posts
move right, cyan where the far side moves left, and black at the centre, where nothing moves.

![A ring of eight pale clay posts topped with clay shapes stands on the light checker floor round the pink PixiJS logo, seen from above and in front, with a small sky-blue spinning top on the floor to the logo's right; the logo and the top are near sharp while the near posts at the bottom are smeared sideways into lilac and pink streaks, and the floor's checks and the far posts blur; in the bottom right a panel tagged velocity shows the same view in false colour, cyan across the far floor, black in a band through the logo, and red and magenta along the bottom, where the near posts show brighter red; the pane in the top right shows autoRotate on, autoRotateSpeed 10.0, a MotionBlurEffect folder with enabled on, intensity 5.00, samples 32 and maxLength 120, and a VelocityViewer folder with scale 0.40](reference.png)

## API

- `MotionBlurEffect` from `@pixi/3d/extras`, in `View3D`'s `passes`. While it's enabled the view writes each pixel's
  velocity, how far its surface moved on screen since the camera's previous render, from the camera's motion alone, and
  the effect blurs the pixel along it. `intensity` is how much of a frame's motion a streak covers: 0.5 is a film
  camera's shutter, and the example opens it to 5 so the streaks read in a still; much wider and the logo at the
  orbit's centre softens too. `samples` (32) is the taps along each
  streak, the pass's cost; at a few the streak breaks into grain. `maxLength` caps a streak in physical pixels, so the
  example multiplies 120 by `app.renderer.resolution`. All three are uniform writes, free every frame; flipping
  `enabled` rebuilds the render graph.
- A streak is one rendered frame's motion, so it shortens as the frame rate rises: on a 120 Hz screen it's half as long
  as on a 60 Hz one. Each pixel blurs along its own motion, so where the moving floor meets the still logo the floor's
  streak picks up a faint pink halo, clearest on the dark theme.
- What writes velocity: opaque surfaces whose material extends `Material3D`, such as the clay and the logo's enamel. A
  blended or glass surface writes none and streaks with what's behind it, and the view's background reads zero, so the
  sky never streaks.
- `VelocityViewer` from `@pixi/3d/extras`, in the inset view's `passes`: it replaces the picture with the velocity. Hue
  is the direction a surface moves on screen (red right, yellow-green up, cyan left, violet down) and brightness its
  speed; `scale` is the brightness each device pixel of motion adds, so the example divides 0.4 by
  `app.renderer.resolution`. At 0.4 the brightness climbs from black at the logo through the near posts to the far
  floor, which sweeps past fastest, rather than filling the panel.
- `view3d.camera.resetHistory()` from `Camera3D`: a resize refits the camera for the new screen and for the inset's
  band along the bottom of a phone in one jump, and can change the camera's aspect: a cut. Resetting makes the next
  frame read no motion instead of smearing the whole picture along the jump; do the same after a teleport or a change
  of shot.
- The inset has a camera of its own, copied from the main one each tick before the frame renders: each camera measures
  motion against its own previous render, so one camera drawn twice in a frame would read no motion the second time.
- `OrbitCamera` from `@pixi/3d/extras` with `autoRotate` and `autoRotateSpeed` (turns a minute; negative turns the other
  way, which swaps every hue in the inset for its opposite). `autoUpdate: false` and `orbit.update(ticker)` from the
  app's ticker move the camera once before each render, by the same steps every run. Its polar limits keep the camera
  high enough for the ring to read and the far posts to stay clear of the logo.
- The first frame: a camera's first render has no previous one to measure from, so it reads no motion. Before the
  canvas joins, 30 `orbit.update()` calls run the damped orbit up to speed and `app.render()` draws twice, so the frame
  the loading screen dissolves onto already streaks and the inset is in colour, not black.
- `Spherical` and `DEG_TO_RAD`: the camera's start round the logo.
- `Mesh3D` and `Container3D`, built once for each view, since a mesh belongs to one view; the `Geometry3D` and the clay
  are shared. `PointData3D` places each shape, and its geometry's `bounds3D` seats it on its post. `PlaneGeometry`
  and a plain `Material3D` give the inset a floor out to the horizon to write velocity for, so the only black above it
  is the sky.
- `View3D`: the main view and the inset's own small one. `Application` from `pixi.js`.

## Controls

- Drag to orbit by hand, which streaks too; scroll to zoom.
- Pane: `autoRotate` pauses the orbit, and the picture turns sharp while the top keeps spinning; `autoRotateSpeed` sets
  the turns a minute. The `MotionBlurEffect` folder has `enabled`, `intensity`, `samples` and `maxLength`; the
  `VelocityViewer` folder has `scale`, the inset's brightness.
- URL flags: `?theme=light|dark`, `?renderer=webgl|webgpu`.

## Files

- `index.ts`: the lesson. The effect, the orbit, the cuts that reset the camera's history, the pane, the tick and the
  first frame's run-up.
- `scene.ts`: the logo, the ring of posts and the spinning top, built once for each view.
- `visuals.ts`: the velocity inset, its copy of the scene, its camera that follows the main one, and the band it
  keeps free along the bottom of a phone.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `clayGeometry`, `clayMaterial`
and `roundedCylinder`, `InsetView` in its own-scene mode, `ThemePane`, `LoadingScreen`, `THEMES` and `themeFromUrl`,
and `fitPortrait` with its `clearBottom` and `refit()`.

## See also

- [Depth of field](../post_depth-of-field/README.md): a blur by depth from a focus plane, in a post effect of your own.
- [Tilt shift](../post_tilt-shift/README.md): `TiltShiftEffect`, which blurs a band of depth so a scene reads as a
  miniature.
- [Stacking effects](../post_effect-stack/README.md): several effects in `passes`, in order.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up, with
the orbit near full speed. `npm run test:example-shots -- post_motion-blur` checks the example against it on
WebGPU and WebGL; add `--update` to retake it after an intended change.
