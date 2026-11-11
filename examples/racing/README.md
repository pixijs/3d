# Racing

A port of [Kenney's Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing) to Pixi 3D, by way of
[mrdoob's three.js port](https://github.com/mrdoob/Starter-Kit-Racing). You drive a truck round a small track of glTF
pieces, with smoke and skid marks behind it and a lap timer over the view.

## Controls

- **Keyboard**: WASD or the arrow keys.
- **Gamepad**: the left stick steers, the right trigger accelerates and the left trigger brakes and reverses.
- **Touch**: drag anywhere to bring up a joystick. The truck turns to face the way you push and drives at full speed.

## What it shows

- Each track piece, decoration and truck is a `.glb` loaded once with `Assets.load`. Every placement is a
  `new Model3D(source)` from that one source.
- One `DirectionalLight` with three shadow cascades follows the truck. The view has ACES tone mapping, a sky and ground
  colour as its `environment`, and linear fog that matches the background.
- The smoke is one `ParticleSystem3D` that the game spawns into at the rear wheels while the truck slides.
- The skid marks are two ribbons whose vertices stream into a `Geometry3D`, uploading only the segment that changed.
- The lap timer and touch joystick are PixiJS 2D (`BitmapText`, `Graphics`) on the same `app.stage` as the
  `View3D`.
- Physics runs in [crashcat](https://github.com/isaac-mason/crashcat), as in the three.js port: the truck rides a
  rolling sphere, and the ground and walls are static boxes.

## Differences from the three.js port

- The port lights the track with a baked grid of light probes. Here a hemisphere environment and the sun do that job.
- The port's bloom pass isn't ported. `BloomEffect` from `@pixi/3d/extras` could add it back.
- The lap timer is drawn with PixiJS 2D instead of DOM elements.
- The port's track editor and custom maps from the URL are left out; the track is fixed in `Track.ts`.

## Files

- `racing.example.ts`: loads the assets, builds the scene and runs the game loop.
- `Vehicle.ts`: drives the truck's physics sphere and moves the body and wheels to match.
- `Track.ts`: lays out the track, decorations and parked trucks on a grid, and builds the wall colliders.
- `Physics.ts`: sets up the crashcat world, the truck's sphere and the static ground and walls.
- `Camera.ts`: a follow camera that leads the truck and lets it drift inside a dead zone.
- `Controls.ts`: merges keyboard, gamepad and touch into one input.
- `TouchJoystick.ts`: the PixiJS 2D joystick.
- `Audio.ts`: Web Audio engine sound with a gear-pitch model, a skid loop and impact sounds.
- `LapTimer.ts`: detects finish-line crossings and draws the lap HUD.
- `DriftMarks.ts`, `Particles.ts`: skid marks and smoke from the rear wheels.

## Assets

The models, textures, sounds and smoke sprite come from the asset mirror as the `racing` group in
`examples/assets/manifest.ts`, served from `/mirror/racing/`. The `.glb` files read their texture from
`/mirror/racing/Textures/colormap.png`, the relative path the kit gives it, so the mirror keeps that layout.

## Credits

The models, sounds and sprites are from Kenney's [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing)
by [Kenney](https://kenney.nl), licensed [CC0](https://creativecommons.org/publicdomain/zero/1.0/). The skid sound is
by [Landeplage](https://github.com/Landeplage). The game code follows
[mrdoob's three.js port](https://github.com/mrdoob/Starter-Kit-Racing) (MIT).
