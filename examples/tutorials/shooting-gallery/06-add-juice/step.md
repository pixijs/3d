---
title: Add juice
active: index.ts
---

The game works. In this step you'll make the bright things glow, flash each target as it's hit, and shake the camera on every hit. Game designers call this kind of feedback juice.

## Bloom

{@link BloomEffect}, from `@pixi/3d/extras`, makes the brightest parts of the picture glow into their surroundings. In `index.ts`, add it to the view's {@link View3D#passes | passes}, its list of extra drawing steps:

```ts
const view3d = new View3D({
  autoResize: true,
  environment: { skyColor: 0x3d3a78, groundColor: 0x120e1c, intensity: 1 },
  passes: [new BloomEffect()],
});
```

Bloom measures brightness in the scene's light, before the view turns it into screen colours, so the bulbs' glow, at `strength` 2, is still brighter than white there. At the default {@link BloomEffect#threshold | threshold} of 1, mostly what's brighter than white glows: the bulbs now, and the flash you add next.

On WebGL2, bloom needs the `EXT_color_buffer_float` extension, and rendering throws on a device without it; [How a frame renders](../../../../src/__docs__/concepts/rendering.md#the-passes-in-a-frame) shows how to check.

## Flash the target

A material is shared by every mesh that uses it, so lighting up the shared `red` would flash every target at once. In `targets.ts`, delete `red` from the top of `createTargets`, and give each target its own inside the loop, before `face`:

```ts
const red = new Material3D({
  baseColor: 0xe0213f,
  roughness: 0.4,
  emissive: { color: 0xff4f7b, strength: 0 },
});
```

Only a material made with an `emissive` option group has an {@link Material3D#emissive | emissive} object, which is why `red` starts with a strength of 0 rather than leaving the group out. Keep the material with the target, so the listener and the ticker can reach it:

```ts
const target = { node, red, speed: rail.speed, down: 0, timer: 0 };
```

Light it up in the `pointerdown` listener, after setting the timer:

```ts
red.emissive.strength = 4;
```

In the ticker, take `red` from the target along with `node`, with `const { node, red } = target;`, and fade the glow:

```ts
red.emissive.strength = Math.max(0, red.emissive.strength - seconds * 8);
```

The flash starts far brighter than white, so bloom makes it glow, and it fades out in half a second.

## Shake the camera

`camera.ts` now keeps the camera's `distance` from the booth. `setupCamera` returns an object whose `shake()` sets the `shake` timer to 0.3 seconds, and `index.ts` calls it on every hit. Fill in the spot that moves the camera while the timer runs:

```ts
app.ticker.add((ticker) => {
  if (shake === 0) return;

  shake = Math.max(0, shake - ticker.deltaMS / 1000);
  camera.position.set((Math.random() - 0.5) * shake, MIDDLE + (Math.random() - 0.5) * shake, distance);
});
```

On each frame of a shake, the camera jumps to a random spot up to half of `shake` from its place in x and y, and `shake` runs down to 0 in 0.3 seconds. The last frame puts the camera back where it started.

Hit a target: it flashes pink as it falls back in confetti, and the booth jolts.
