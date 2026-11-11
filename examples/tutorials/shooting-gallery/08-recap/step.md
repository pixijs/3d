---
title: Recap
---

You've built a complete little game: a fairground booth lit by spotlights, targets that slide along rails and fall when hit, confetti, a score in 2D and on a 3D board, bloom, a flash and a shake on every hit, and a timed round. Along the way you used:

- primitives, with one geometry shared by many meshes and scaled to size, and {@link Material3D} with a clear coat, a metal and an emissive glow;
- two {@link SpotLight}s that cast shadows;
- {@link Container3D} nodes to carry each rail's targets to its height, and to turn a target around its foot;
- `eventMode`, `hitVolume` and `pointerdown` to hit 3D objects with the pointer;
- a {@link ParticleSystem3D} that emits only when you call `spawn`;
- a {@link ContainerTexture} to show 2D content on a 3D mesh;
- a {@link BloomEffect} in the view's `passes`, and a material's glow changed while the game runs;
- PixiJS `Text` and `Graphics` for the score, the clock and the end-of-round panel.

## Where to go next

- [Interaction](../../../../src/events/__docs__/interaction.md) covers pointer events in 3D: hit volumes, propagation, dragging and picking without events.
- [Particles](../../../../src/extras/__docs__/particles.md) covers emitter shapes, controlling a system, and particles your own code moves.
- [Rendering 2D into 3D](../../../../src/core/__docs__/container-texture.md) goes further with `ContainerTexture`, including content that changes every frame.
- [Post-processing](../../../../src/post-processing/__docs__/post-processing.md) lists the effects you can add to `passes`, and shows how to write your own.
- [Lights](../../../../src/scene/__docs__/lights.md) and [Shadows](../../../../src/scene/__docs__/shadows.md) cover spotlights, the other kinds of light, and shadow settings.

From here, try targets that score more the faster they move, a row of ducks that bobs up and down, or a best score that survives the restart.
