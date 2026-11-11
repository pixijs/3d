# Local and world space

A particle system's `space` decides whether its particles ride with the node or stay where they were born. Two clay
cubes go round their rings, each carrying a `ParticleSystem3D` built from the same options, one with
`space: 'local'` and one with `space: 'world'`. Local sparks travel with their emitter like a candle flame on a
moving tray; world sparks keep the place they were born, so a moving emitter leaves a trail. Stand the cubes still
and the two plumes take one shape.

![Two clay cubes on drawn rings over the light checker floor: the pink cube on the left, tagged local, carries red, green and blue axes and a pink plume rising straight up from its top, and the sky cube on the right, tagged world, trails a long stream of blue sparks behind it along its ring; small axes at the origin between them are tagged origin; the pane in the top right shows Turn speed 0.80 and a space folder with pink local and sky world](reference.png)

## API

- `ParticleSystem3D` from `@pixi/3d/extras` with `space`, a `ParticleSpace`: `'local'` keeps the sparks in the
  system's own space, so they move and turn with the cube they're a child of; `'world'`, the default, writes each
  spark's birth place in world space, so it stays there whatever the emitter does next.
- `space` is read-only on a live system, so the pane `destroy()`s the old system and builds a new one in its place. A
  plain `destroy()` leaves the shared spark texture alive.
- One `ParticleSystem3DOptions` object for both systems, so `space` is the only difference: a `ConeShape`, `life`,
  `speed`, `size` with `sizeEnd`, `alpha` with `alphaEnd`, `drag`, and an upward `gravity` vector that lifts the sparks
  like embers. `gravity` is in the system's own space, like the sparks' velocity.
- `createRandom: () => seededRandom('sparks')`: both systems start one seeded stream, so on load they draw the same
  sparks; a system built later starts it over, so the plumes then match in shape but not spark for spark.
- `autoUpdate: false` with `update()` from the app's ticker; 3.5 s of steps before the first frame lay the whole trail
  down where the cube really went.
- `Container3D` at each ring's centre, turned about y to carry its `Mesh3D` cube round; the system is the cube's
  child.
- `OrbitCamera` from `@pixi/3d/extras` on the `View3D`: drag to orbit. The view's `setSize()` and the orbit's `zoom()`
  lay the rings side by side on a wide screen and one behind the other on a tall one.
- `Application` and `Renderer` from `pixi.js`: the app, and the renderer whose `resize` event refits the layout.

## Controls

- Drag to orbit.
- Pane: `Turn speed` sets how fast the cubes go round, in radians a second, and 0 stands them still; the `space`
  folder sets the `pink` and `sky` cubes' spaces, `local` or `world`.

## Files

- `index.ts`: the lesson. The shared options, the two systems, swapping a space, and the pane.
- `scene.ts`: the clay cubes on their rings, the turn at the pane's speed, and the layout for the screen.
- `visuals.ts`: each ring's path, the local system's axes on its cube, the world's axes at the origin, and the
  placards naming each space; it reads the scene and never changes it.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, the palette,
`sparkTexture()`, `clayMaterial`, `clayGeometry`, `LabelLayer`, `PathHelper` and `AxesHelper`.

## See also

- [Particle system](../particles_basics/README.md): the options both systems are built from.
- [Bursts on demand](../particles_spawn/README.md): next, sparks spawned at a tap, and a seeded timeline you replay.
- [Fire and smoke](../particles_flipbook/README.md): the cards' billboard modes and blend modes.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- particles_spaces` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
