---
title: Particles
description: Fire, smoke, sparks and snow with ParticleSystem3D, and particles your own code moves with ParticleContainer3D.
category: extras:particles
---

# Particles

A particle is a small flat card, such as a spark or a snowflake, that turns to face the camera {@link ParticleContainer3DOptions#billboard | by default}. PixiJS 3D draws particles two ways:

- {@link ParticleSystem3D}, from `@pixi/3d/extras`, emits particles and moves them on its own, as its options describe.
- {@link ParticleContainer3D}, from `@pixi/3d`, draws particles where your code puts them. A particle system is a particle container with the behaviour built in.

Each draws all its particles in one draw call.

## A particle system

This system makes a campfire's flames:

```ts
import { ConeShape, ParticleSystem3D } from '@pixi/3d/extras';
import { Texture } from 'pixi.js';

// A soft white dot, drawn on a canvas
const canvas = document.createElement('canvas');

canvas.width = canvas.height = 128;
const context = canvas.getContext('2d')!;
const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);

gradient.addColorStop(0, 'rgba(255,255,255,1)');
gradient.addColorStop(0.22, 'rgba(255,255,255,0.55)');
gradient.addColorStop(1, 'rgba(255,255,255,0)');
context.fillStyle = gradient;
context.fillRect(0, 0, 128, 128);

const dot = Texture.from(canvas);

const flames = new ParticleSystem3D({
  texture: dot,
  blendMode: 'add',
  billboard: 'cylindrical',
  capacity: 120, // emitRate times the longest life, 110 × 1, rounded up
  emitRate: 110,
  shape: new ConeShape({ angle: 12, radius: 0.22 }),
  life: [0.5, 1],
  speed: [1.5, 2.3],
  size: [0.5, 0.85],
  sizeEnd: [0.05, 0.2],
  alpha: 0.7,
  alphaEnd: 0,
  color: 0xffd98a,
  colorEnd: 0xd12b06,
  drag: 1.6,
});

flames.position.y = 0.2;
view3d.root.addChild(flames);
```

A system starts emitting as soon as you create it and updates itself every frame. Add it under {@link View3D#root | view3d.root} to see it. Leave out {@link ParticleContainer3DOptions#texture | texture} and each particle is a solid square of its `color`.

[Particle system](/3d/examples?example=particles_basics) changes a running system's rate, shape, gravity and drag from a panel.

A system has a fixed number of slots, one per particle. That number is its {@link ParticleContainer3DOptions#capacity | capacity}. The system fills the slots in turn, so once it has used them all, a new particle takes the oldest particle's slot, even if that particle is still alive. Make the capacity big enough to hold every particle born within the longest `life`, or particles vanish early. For a steady stream, that's about `emitRate` times the longest `life`. Don't go far past it, because the GPU works on every slot each frame, live or empty, and the view draws a system even when it's off screen.

## Options

{@link ParticleSystem3DOptions} lists every option. Numbers set per particle, such as `life`, `size` and `speed`, take one value or a `[min, max]` range. Each particle picks a value from the range when it's born. `color` and `colorEnd` take one colour each.

- **Where they start.** `shape` sets where each particle starts and which way it moves. It's a {@link PointShape} by default. Use a {@link ConeShape} for flames and smoke, a {@link SphereShape} for bursts, a {@link BoxShape} for snow, or your own {@link EmitterShape}. The point, cone and box send particles up, so rotate the system to aim them another way.
- **How they move.** `speed` is how fast particles leave along the shape's direction. It's 0 by default, so without `speed` or `gravity`, particles stay where they're born. A positive number for `gravity` pulls particles down, and a negative one lifts them. An `{ x, y, z }` value sets the acceleration directly, so `gravity: 9.8` is the same as `{ x: 0, y: -9.8, z: 0 }`. `drag` slows particles down.
- **How they change.** `sizeEnd`, `alphaEnd` and `colorEnd` set the value each particle reaches at the end of its life, and `spin` rotates it. Leave one out and the particle keeps its starting value. Each one you set adds work to the shader, so set only what the effect needs.
- **How they look.** `color` multiplies the texture, as a 2D tint does, so draw the sprite white and colour it here. A `blendMode` of `'add'` brightens what's behind, so overlapping flames add up to a brighter glow. A `billboard` of `'cylindrical'` keeps flames upright as the camera tilts. They get thinner the further the camera looks down, and vanish when it looks straight down. A `billboard` of `'horizontal'` lays particles flat on the ground, for rings. Pass `texture` an array of frames from one sprite sheet and each particle gets a random frame by default. Set {@link ParticleSystem3DOptions#frameMode | frameMode} to `'animate'` or `'overLife'` to play the frames as a flipbook. A flipbook needs the frames laid out as a grid of equal cells, left to right from the top left. With a packed atlas, a flipbook can play the wrong cells.

`size` is a diameter in world units, not pixels, and scaling the system doesn't change it. Particles are unlit. Lights don't reach them, and they don't cast or receive shadows.

[Fire and smoke](/3d/examples?example=particles_flipbook) shows the three billboard modes, the blend modes and flipbook frames on a campfire.

## Controlling a system

{@link ParticleSystem3D#stop | stop} stops emitting and lets live particles finish their lives. {@link ParticleSystem3D#play | play} starts emitting again. {@link ParticleSystem3D#clear | clear} removes every live particle at once. You can change `emitRate` at any time, but size the capacity for the highest rate. You can change {@link ParticleSystem3D#gravity | gravity} and {@link ParticleSystem3D#drag | drag} too, but assign a new value. Editing `gravity.x` in place doesn't reach the particles. The system works out each particle's path from the moment that particle was born, so changing either one moves every particle already in the air, not only new ones.

{@link ParticleSystem3D#spawn | spawn} emits particles right away, whether the system is playing or stopped. It can override some options for that batch, and takes `velocity` in place of `speed`. {@link ParticleSpawnOverrides} lists which options. With `emitRate: 0`, a system emits only what you `spawn` and what its {@link ParticleSystem3DOptions#bursts | bursts} release on a schedule. In the shooting gallery tutorial, confetti spawns where the player hits a target:

```ts
target.eventMode = 'static';
target.on('pointerdown', (e) => {
  if (e.hit3D) confetti.spawn(12, { position: e.hit3D.point, color: 0xffc93c });
});
```

`position` puts the batch at a point in the world, not at the system, so one system handles every hit.

A system updates on pixi's `Ticker.shared`, not your `app.ticker`, unless you create the app with `sharedTicker: true`. So pausing or slowing `app.ticker` doesn't pause or slow the particles. To keep a system in step with your game, create it with `autoUpdate: false` and call {@link ParticleSystem3D#update | update} from your own loop. Setting `app.ticker.speed` to 0 then freezes the particles.

```ts
const smoke = new ParticleSystem3D({ ...smokeOptions, autoUpdate: false });

app.ticker.add((ticker) => smoke.update(ticker));
```

{@link ParticleSystem3D#time | time} is the system's clock in seconds. Set it, forwards or backwards, to show any moment the slots still hold. Setting it doesn't emit particles. To scrub through time, turn off `autoUpdate`. Before you turn it back on, set `time` to the latest moment the system reached, or the particles born after the moment you picked show twice.

Give a system `createRandom: () => seededRandom('fireworks')` and it draws the same random values in the same order every run, so {@link ParticleSystem3D#gotoAndPlay | gotoAndPlay(0)} replays the same burst. {@link seededRandom} makes the generator.

[Bursts on demand](/3d/examples?example=particles_spawn) puts these calls on buttons, spawns where you tap and scrubs `time`.

## World and local space

By default a particle lives in world space. It starts wherever the system is when it's born and doesn't follow the system after that. Move a chimney and the smoke already in the air stays where it was.

With {@link ParticleContainer3DOptions#space | space: 'local'}, particles move, rotate and scale with their system. Use it for effects such as a glow that follows a moving orb. Gravity then acts in the system's own space too, so in a system turned upside down it pulls particles up. Positions you write into a particle container or pass to `spawn` use the same space.

## Draw order

The particles in one system draw in slot order, not sorted by distance. With a {@link ParticleContainer3DOptions#blendMode | blendMode} of `'normal'`, a far particle drawn later covers a near one. `'add'`, `'screen'` and `'multiply'` look the same in any order. For hard-edged particles such as leaves, {@link ParticleContainer3DOptions#alphaMode | alphaMode: 'mask'} cuts each one out along its texture's edge, so the nearer particle covers the farther one. When the view sorts a system against other blended meshes, it treats the system as one object at the system's position, wherever its particles have gone.

## Driving particles yourself

A {@link ParticleContainer3D} draws particles that something else moves, such as a physics engine or a recording. It has a fixed number of slots and no object per particle. Write each particle into its slot, then call {@link ParticleContainer3D#upload | upload} once a frame:

```ts
import { packParticleColor, ParticleContainer3D } from '@pixi/3d';

const motes = new ParticleContainer3D({ texture: dot, capacity: 2000, blendMode: 'add' });
const tint = packParticleColor(0x66ff99, 1);

view3d.root.addChild(motes);

app.ticker.add(() => {
  for (let i = 0; i < count; i++) motes.writePacked(i, x[i], y[i], z[i], 0.1, 0, tint);
  motes.upload();
});
```

{@link ParticleContainer3D#writePacked | writePacked} takes the tint and opacity packed into one number by {@link packParticleColor}, so particles that share a tint pack it once. {@link ParticleContainer3D#setParticleAt | setParticleAt} takes them unpacked. A slot keeps drawing what you last wrote into it. So when fewer particles are left, write a size of 0 into the slots you stop using, or {@link ParticleContainer3D#clear | clear} every slot first, as [Particle container](/3d/examples?example=particles_container) does when you change its count.

## Adding your own shader code

A system builds its shader from shader bits, small pieces of shader code, one for each behaviour. The {@link ParticleContainer3DOptions#extraBits | extraBits} option adds your own, which run after the built-in ones. This one sways each particle from side to side:

```ts
import type { ShaderBit } from '@pixi/3d';
import { ParticleSystem3D } from '@pixi/3d/extras';

const sway = {
  name: 'sway',
  bindings: { material: { uSwayAmp: 'f32', uSwayFreq: 'f32' } },
  gpu: {
    vertex: { beforeTransform: /* wgsl */ `position.x += sin(particleAge * material.uSwayFreq) * material.uSwayAmp;` },
  },
  gl: {
    vertex: { beforeTransform: /* glsl */ `position.x += sin(particleAge * material.uSwayFreq) * material.uSwayAmp;` },
  },
} satisfies ShaderBit;

const snow = new ParticleSystem3D({ ...snowOptions, extraBits: [sway] });

snow.uniforms.uSwayAmp = 0.5;
snow.uniforms.uSwayFreq = 0.8;
```

Your shader code can read `particleAge`, in seconds, and `particleProgress`, which runs from 0 at birth to 1 at death. It can change `position`, which is in world space unless the system is local. It can also change `particleSize`, `particleRotation` and `particleColor`, which {@link getParticleBit} describes. Set the `material` values your bit declares through {@link ParticleContainer3D#uniforms | uniforms}. A vector takes an array, such as `[1, 0, 0]`. [Toon and custom materials](./custom-materials.md#adding-your-own-shader-code) shows how to write a bit.

[Custom particle behaviour](/3d/examples?example=particles_custom-bits) swirls sparks with a bit of its own.

## Cleaning up

{@link ParticleSystem3D#destroy | destroy} stops a system updating, removes it from the scene and frees what it created. It doesn't free the texture you gave it. {@link ParticleContainer3D#destroy} lists the flags that do. Removing a system from the scene yourself doesn't stop it updating or emitting.

## Next steps

- [Post-processing](../../post-processing/__docs__/post-processing.md#bloom): bloom, a glow around light brighter than white.
- [Interaction](../../events/__docs__/interaction.md#3d-event-fields): finding the point in the world where a click lands, to spawn particles there.
- [Choosing a node for many objects](../../scene/__docs__/scene.md#choosing-a-node-for-many-objects): when particles fit better than sprites or batched meshes.
