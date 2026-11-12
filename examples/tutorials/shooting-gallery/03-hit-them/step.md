---
title: Hit them
---

Targets are for hitting. In this step you'll make each target fall back when you hit it, and stand up again two seconds later.

Each target in `targets.ts` now carries two more numbers: `down`, from 0 standing to 1 flat on its back, and `timer`, the seconds it has left to stay down. `DOWN_SECONDS`, at the top of the file, is how long that is.

## Listen for hits

3D nodes take PixiJS's own pointer events. Fill in the spot below `const target`:

```ts
node.eventMode = 'static';
node.hitVolume = 'box';
node.interactiveChildren = false;
node.on('pointerdown', () => {
  if (target.timer > 0) return;

  target.timer = DOWN_SECONDS;
});
```

- An {@link Container3D#eventMode | eventMode} of `'static'` makes the node fire its pointer listeners, as in 2D. To find what's under the pointer, the view casts a ray from the camera through the pointer into the scene.
- {@link Container3D#hitVolume | hitVolume} is the shape the ray is tested against, the 3D version of `hitArea`. On a plain `Container3D` like this target, `'box'` measures a box around its children once, when you set it, so set it after they're added.
- With {@link Container3D#interactiveChildren | interactiveChildren} set to `false`, the view tests that one box per target, not each of the four meshes inside it. [Interaction](../../../../src/events/__docs__/interaction.md#hit-volumes) covers the other shapes a hit volume can take.
- `pointerdown` fires the moment you press. A `pointertap` waits for the release, and reaches the target only if the pointer is still over it, so a target that slides away in between never gets it.

A target that's already down ignores the hit. The ray passes through meshes that aren't [hit-tested](../../../../src/events/__docs__/interaction.md#event-modes), so a target that has slid into a side wall can still be hit through it. To make a mesh stop shots, set its `eventMode` to `'static'` too.

## Fall and stand up

In the ticker, below the code that slides each target, count its timer down and tip it toward where it should be:

```ts
target.timer = Math.max(0, target.timer - seconds);
target.down += ((target.timer > 0 ? 1 : 0) - target.down) * Math.min(1, seconds * 12);
node.rotation.x = -target.down * (Math.PI / 2);
```

- While the timer runs, `down` moves quickly toward 1, then back toward 0 once it runs out.
- A target turns around its origin, at its foot, so a quarter turn around x lays it flat. A negative angle tips its top away from you.

Click or tap the targets. Each one drops back, keeps sliding along its rail, and stands up again two seconds later.
