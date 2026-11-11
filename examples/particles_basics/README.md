# Particle system

One options object sets how many sparks are born each second and where, how they fly, and how they look from birth to
death. A clay firework tube sprays orange sparks that cool to purple, under the emitter's shape, the path an average
spark flies with and without drag, and an arrow for gravity. A spark is written once, at birth, and the vertex shader
works out where it is from that and the clock, so the whole spray is one draw call.

![A sky-blue clay firework tube on a lilac base sprays orange and purple sparks over the light checker floor; a wire cone on the nozzle is tagged emitter shape, a solid pink arc tagged with drag falls short of a dashed arc tagged no drag, and an arrow tagged gravity hangs from the top of the solid arc; the pane in the top right shows emitRate 300, shape ConeShape, gravity 9.8 and drag 0.50](reference.png)

## API

- `ParticleSystem3D` from `@pixi/3d/extras`, built from one `ParticleSystem3DOptions` object. `emitRate` (300 a
  second), `bursts` (120 sparks at 1.6 s, again every 4.5 s through `repeatEvery`) and `shape` decide the births;
  `life`, `speed`, `gravity` and `drag` the flight; `size`, `alpha` and `color` with `sizeEnd`, `alphaEnd` and
  `colorEnd` the look over each life. A `[min, max]` pair is a `ParticleSpread`: each spark draws its own value.
- `emitRate`, `shape`, `gravity` (a bare number pulls straight down) and `drag` change on a running system, as do a
  burst's `count` and `repeatEvery`; the rest are fixed when it's built.
- `PointShape`, `ConeShape` (`angle`, `radius`), `SphereShape` (`radius`) and `BoxShape` (`width`, `height`, `depth`)
  from `@pixi/3d/extras`: the four built-in `EmitterShape`s, where each spark starts and which way it heads. The system
  reads its shape at every birth, so a swap changes the next sparks only.
- `createRandom: () => seededRandom('fountain')`: a seeded stream, so every run sprays the same sparks.
  `autoUpdate: false` with `update(ticker)` on the app's ticker; 120 bare `update()` steps start the fountain 2 s in.
- `View3D`, `Mesh3D`, `Container3D`, `Vector3`, `PointData3D` and `Destroy3DOptions`: the scene, the tube, the
  diagram's points and `EmitterShapeHelper`'s `destroy()`. `OrbitCamera` from `@pixi/3d/extras`: drag to orbit.
- `Application`, `Rectangle`, `Point` and `DEG_TO_RAD` from `pixi.js`: the app, the labels' bounds and layout, and
  the cone's angle in radians.

## Controls

- Drag to orbit.
- Pane: `emitRate` sets sparks a second; `shape` picks `PointShape`, `ConeShape`, `SphereShape` or `BoxShape`;
  `gravity` sets the pull down and `drag` how fast speed dies away. The outline and both paths follow every change.

## Files

- `index.ts`: the lesson. The system's options, the four shapes, the pane and the frame loop.
- `scene.ts`: the clay firework tube, and its nozzle where the sparks leave.
- `visuals.ts`: the labels and the emitter's outline; it reads the system and never changes it.
- `EmitterShapeHelper.ts`: a helper that outlines a built-in shape, with arrows the ways its sparks head.
- `sparkDiagram.ts`: the with-drag and no-drag paths, the gravity arrow, and where their labels go.
- `sparkPath.ts`: one spark's flight on the CPU, with the motion shader's formula, so the paths land on the sparks.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `fitPortrait`,
the palette's `BRAND` colours, `sparkTexture()`, `clayMaterial` and `roundedCylinder` for the tube, `LabelLayer`,
`PathHelper` and `ArrowHelper` for the diagram, and `Helper` on a `BarsGeometry` under `EmitterShapeHelper`.

## See also

- [Fire and smoke](../particles_flipbook/README.md): next, flipbook frames, billboard modes and blend modes.
- [Local and world space](../particles_spaces/README.md): whether sparks ride with a moving emitter or leave a trail.
- [Bursts on demand](../particles_spawn/README.md): `spawn()` at a tap, and a seeded timeline you replay and scrub.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- particles_basics` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
