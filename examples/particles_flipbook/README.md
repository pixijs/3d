# Fire and smoke

Flipbook particles, billboard modes and blend modes, on a clay campfire. A `ParticleSystem3D` draws each particle as a
flat square card: pass frames cut from one sheet as its `texture` and `frameMode` picks which frame a card shows,
`billboard` turns the cards to the camera, upright or flat on the ground, and `blendMode` says how their colour meets
what's behind. Three systems show the three billboard modes at once: upright flames, smoke puffs that face the camera
fully, and heat rings that spread flat over the floor.

![A clay campfire on the light checker floor: four orange logs crossed on a dark plum ash bed inside a ring of white and lilac stones, with orange and pink flame cards over the logs, a column of grey smoke puffs above, and soft orange rings spreading over the floor; the pane in the top right shows frameMode overLife, a greyed frameRate of 24, billboard cylindrical and blendMode normal](reference.png)

## API

- `ParticleSystem3D` from `@pixi/3d/extras` with an array of `Texture`s as its `texture`: a multi-frame sheet. Every
  frame has to share the sheet's one source, since a system draws in one call that binds one texture.
- `frameMode` (`ParticleSystem3DOptions`): `'overLife'` plays the flame's 16 frames once across each flame's life,
  `'animate'` loops them at `frameRate` frames a second, and `'random'` deals each particle one frame for life, as the
  smoke does with its four puffs.
- `billboard`: `'cylindrical'` turns the flames about the vertical only, so they stay upright when the camera looks
  down; `'spherical'` turns the puffs to face the camera fully; `'horizontal'` lays the rings flat on the ground.
- `blendMode`: `'normal'`, `'add'`, `'multiply'` or `'screen'`. `'add'` only brightens, so it shows best on the dark
  floor.
- `frameMode` and `billboard` are built into the shader, so a change builds a new system and `destroy()`s the old;
  `frameRate` and `blendMode` are setters on a running one.
- `gravity` as a vector: `{ x: 0, y: 1, z: 0 }` lifts the flames like hot gas, and a slight sideways pull drifts the
  smoke like a breeze. `ConeShape` sets where flames and smoke start, and `drag`, `size` with `sizeEnd`, `alpha` with
  `alphaEnd`, and `color` shape their lives.
- `createRandom` with `seededRandom`: a seeded stream each for the flames and the smoke, so every run burns the same
  fire.
- `autoUpdate: false` with `update()` from the app's ticker; `update()` with no ticker steps 1/60 s, which warms each
  system before the first frame.
- `View3D`, `Mesh3D` and `Container3D`: the scene and the campfire's logs, stones and ash bed.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application`, `Texture`, `Rectangle` and `DEG_TO_RAD` from `pixi.js`: the app, the sheets and the frames cut from
  them, and the logs' tilt.

## Controls

- Drag to orbit; look down on the fire to see the billboard modes part.
- Pane: `frameMode`, `frameRate` (live under `animate` only), `billboard` and `blendMode` set the flames. Theme puts
  the fire over a dark floor, where `add` and `screen` glow.

## Files

- `index.ts`: the lesson. Cutting the sheets into frames, the three systems, and the pane.
- `sheets.ts`: the 4 × 4 flame sheet, the 2 × 2 smoke sheet and the ring, drawn on canvases in palette colours.
- `scene.ts`: the clay campfire: an ash bed, four logs and a ring of stones.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with its `spotlight`, `ThemePane`,
`LoadingScreen`, `fitPortrait`, the palette (`BRAND`, `CLAY`, `mixColor`, `cssColor`), `clayMaterial`,
`clayGeometry` and `roundedCylinder`.

## See also

- [Particle system](../particles_basics/README.md): the options every system here is built from.
- [Local and world space](../particles_spaces/README.md): next, whether particles ride with their emitter.
- [Custom particle behaviour](../particles_custom-bits/README.md): motion of your own in the particle shader.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- particles_flipbook` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
