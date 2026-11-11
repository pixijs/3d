# Particle container

Particles you drive yourself: a `ParticleContainer3D` is a fixed pool of particles drawn in one call, and your own code
says where each one is every frame. Here 4000 pink dots sampled from the PixiJS logo's surface hang over the floor,
each springing toward its home while a smooth flow, and now and then a gust, pushes it off. The pool's one draw covers
every slot, used or not, so the draw count stays at one whatever `count` is.

![The PixiJS logo drawn as a cloud of small round pink dots hanging over the light checker floor, its P, first i and x readable from the dots alone while a gust scatters the second i and the JS badge on the right; the pane in the top right shows count 4000, noise 0.35, size 0.04 and draw calls 1](reference.png)

## API

- `ParticleContainer3D`: a pool of `capacity` slots (8000 here), fixed for its life. An empty slot still costs four
  vertices, so `capacity` is the peak count. `texture` makes each quad a round dot; without one every particle is a
  white square.
- `space: 'local'`: the points live in the container's own space, so the slow sway of its `rotation` moves them all
  at no cost per particle.
- `writePacked(i, x, y, z, size, rotation, color)`: writes slot `i` with a colour packed once up front by
  `packParticleColor`. `setParticleAt()` writes the same but packs its colour on every call.
- `upload()`: once a frame, after every write, sends one range covering them all.
- `clear()`: sets every slot's size to 0. A slot keeps its last write, so a lower `count` would leave old dots
  drawing; the pane clears and the next frame writes the first `count` again.
- `RenderGraphDebugger` from `@pixi/3d/extras`: `capture()` reads back the last frame's draws, and the pane counts
  those whose `sourceMeshIds` include the container's `uid`, twice a second, since a capture allocates.
- `Mesh3D`, `Matrix4`, `Vector3` and `seededRandom`: the logo's triangles read into its own space and sampled by area,
  from a seeded stream so every run makes the same cloud.
- `OrbitCamera` from `@pixi/3d/extras` on the `View3D`: drag to orbit, scroll in to see the dots are flat sprites.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit; scroll in to see the dots up close.
- Pane: `count` sets how many slots the loop writes, `noise` how hard the flow pushes, and `size` each dot's width in
  world units; `draw calls` reads back the particles' draws.

## Files

- `index.ts`: the lesson. The container, the write loop, the pane and the draw-call readout.
- `scene.ts`: the logo's surface as points, spread by area and in random order, so any first `count` covers the logo.
- `simulation.ts`: the springs, the flow and the gust, in plain arrays the container never sees.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `fitPortrait`,
the palette, `loadPixiLogo` and `pointTexture()`.

## See also

- [Particle system](../particles_basics/README.md): `ParticleSystem3D` builds on this class and runs a standard
  simulation for you.
- [Custom particle behaviour](../particles_custom-bits/README.md): motion worked out in the vertex shader instead of
  on the CPU.
- [Custom emitter](../particles_custom-emitter/README.md): the same logo sampled by area, as where sparks start.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- particles_container` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
