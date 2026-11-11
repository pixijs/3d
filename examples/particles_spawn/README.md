# Bursts on demand

`spawn()` bursts now, wherever you say, and a seeded burst timeline stops, clears, replays and scrubs. A purple clay
launcher fires a repeating show of three pink pops, and a tap on the floor bursts there. The random stream restarts on
every seek, so after `gotoAndPlay(0)` the first show flies its first run's sparks again: ink paths trace where some
flew, and a ring rides each path where the seed puts that spark, while it lasts. The picture falls between shows:
the first show's last sparks fade as they fall, their rings already gone, and the paths stay as the seed's record.

![A purple clay launcher puck on the light checker floor with thin ink arcs fountaining out of it, tagged seeded paths, and a few faint pink sparks falling beside them as the first show dies away; the pane in the top right shows a sparks folder with count 40, buttons stop(), play(), clear(), gotoAndPlay(0) and gotoAndStop(0), playing true and scrub 0.00](reference.png)

## API

- `ParticleSystem3D` from `@pixi/3d/extras` with `emitRate: 0` and `bursts`, three `ParticleBurst`s (`time`,
  `count`, `repeatEvery`): pops at 0.2, 0.8 and 1.4 s from a `ConeShape`, repeating every 2.4 s.
- `spawn(count, { position, color })`: a batch right now at the tapped point, playing or not, with `position`
  standing in for the emitter's. It draws from the pops' stream, so it moves every pop after it.
- `createRandom: () => seededRandom('stream')`: called when the system is built and on every seek, so each seek
  restarts the same stream.
- `stop()` ends the pops and lets the air clear, `play()` carries on, `clear()` empties the air while the pops carry
  on, and `playing` says which. `gotoAndPlay(0)` moves the burst timeline back and plays; `gotoAndStop(0)` waits for
  `play()`.
- `time`: the clock the sparks render against, which a seek doesn't move. A spark is its birth record plus the clock,
  so assigning `time` shows any moment exactly, with nothing resimulated.
- `autoUpdate: false` with `update(ticker)`, so the lesson can hold the clock; with no `Ticker`, `update()` steps one
  60 fps frame.
- `data` (`f32`, `floatStride`, `offsets`), `capacity`, `gravity` and `drag`: the visuals run the motion shader's
  formula on each birth record, so a ring lands where the shader puts its spark.
- `pointertap` on the floor's `Mesh3D`, with `hit3D.point` where the pick's ray met it. `View3D`, `Container3D`,
  `Vector3` and `PointData3D` hold the scene and the traced points. `OrbitCamera` from `@pixi/3d/extras` orbits.
- `Application` and `Ticker` from `pixi.js`.

## Controls

- Tap the floor to burst there; drag to orbit.
- Pane, `sparks` folder: `count` sets a tap's burst; `Stop`, `Play`, `Clear`, `Replay` and `Rewind` run the call on
  each button; `playing` reads the flag; `scrub` holds the clock up to 3 s back, which stops the show until Play.
  Replay, and the first show flies back into its rings; Rewind, tap, then Play, and the pops leave them.

## Files

- `index.ts`: the lesson. The show, the system, each call, the scrub and the tap.
- `controls.ts`: the pane's `sparks` folder.
- `scene.ts`: the clay launcher, and taps on the floor that ignore the end of an orbit drag.
- `records.ts`: reading each spark's birth record from `data`, and the motion formula that places it.
- `ghosts.ts`: the seeded paths, their rings, and an arrow from a ring to its spark once a spawn moves the stream.
- `visuals.ts`: the ghosts and the label; it reads the system and never changes it.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` and its `floor`, `ThemePane`, `LoadingScreen`,
`fitPortrait`, the palette, `sparkTexture()`, `clayMaterial`, `roundedCylinder`, `LabelLayer`, `PathHelper` and
`PointsHelper`.

## See also

- [Particle system](../particles_basics/README.md): `emitRate`, `bursts` and the rest of the options.
- [Custom emitter](../particles_custom-emitter/README.md): next, an `EmitterShape` of your own.
- [Local and world space](../particles_spaces/README.md): where a spark's birth record is measured from.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- particles_spawn` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
