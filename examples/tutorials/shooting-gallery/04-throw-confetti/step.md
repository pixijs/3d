---
title: Throw confetti
---

A hit deserves a celebration. In this step you'll burst confetti from the spot where each target is hit.

`createTargets` now takes a third argument, a function it calls on each hit. A 3D pointer event carries what the ray hit as {@link Event3DFields#hit3D | hit3D}, and the listener passes on its `point`: where the ray met the target's box, in world space, the scene's own coordinates rather than the target's. PixiJS reuses the event for later ones, so copy the point's `x`, `y` and `z` if you keep it. `index.ts` hands the point to `burst`, which you'll write in `createConfetti`, in `confetti.ts`.

## A particle system

{@link ParticleSystem3D}, from `@pixi/3d/extras`, emits small particles and moves them for you. With no texture, each particle is a white square that turns to face the camera, which suits confetti. Make one that emits only when asked:

```ts
const confetti = new ParticleSystem3D({
  capacity: 600,
  emitRate: 0,
  shape: new SphereShape({ radius: 0.1 }),
  life: [1, 1.6],
  speed: [2.5, 5],
  size: [0.07, 0.13],
  startRotation: [0, Math.PI * 2],
  spin: [-10, 10],
  gravity: 7,
  drag: 1.2,
  alphaEnd: 0,
});

view3d.root.addChild(confetti);
```

- {@link ParticleContainer3DOptions#capacity | capacity} is how many particles can be alive at once.
- {@link ParticleSystem3DOptions#emitRate | emitRate} at 0 turns off the steady stream, so particles appear only when you call `spawn`.
- `shape` sets where particles start and which way they head. A {@link SphereShape} sends them out in every direction from inside a small ball.
- A pair such as `[1, 1.6]` gives each particle its own value between the two, so each flake lives 1 to 1.6 seconds and starts at its own angle.
- {@link ParticleSystem3DOptions#size | size} is in world units, like positions, not in pixels.
- `spin` turns the flakes as they fly, `gravity` pulls them down, `drag` slows them, and `alphaEnd: 0` fades each one out by the end of its life.

## Burst

Fill in `burst`, which spawns flakes at a point:

```ts
for (const color of COLORS) confetti.spawn(12, { position, color });
```

{@link ParticleSystem3D#spawn | spawn} emits particles right away, and its second argument replaces some of the system's options for that batch: here, where the flakes start and their colour. A batch takes one colour, so the burst spawns twelve flakes in each of the five `COLORS`.

Hit a target: it falls back in a shower of colour.
