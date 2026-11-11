---
title: Follow the pointer
---

In this step you'll make the camera follow the pointer, so you see the shapes from a new angle as it moves.

`index.ts` now calls `followPointer` in `pointer.ts`. Work inside it.

## Listen to the pointer

Make the stage interactive and keep track of where the pointer is:

```ts
const pointer = { x: 0, y: 0 };

app.stage.eventMode = 'static';
app.stage.on('globalpointermove', (event) => {
  pointer.x = (event.global.x / app.screen.width) * 2 - 1;
  pointer.y = (event.global.y / app.screen.height) * 2 - 1;
});
```

`globalpointermove` fires on every pointer move anywhere on the page, whatever is under the pointer. `event.global` is the pointer's position in pixels, and the two lines turn it into a fraction from -1 to 1, across the screen and down it.

## Move the camera

On each frame, ease the camera part of the way toward a point set by the pointer, then turn it back to face the middle of the scene:

```ts
app.ticker.add((ticker) => {
  const { camera } = view3d;
  const ease = 0.04 * ticker.deltaTime;

  camera.position.x += (pointer.x * 1.5 - camera.position.x) * ease;
  camera.position.y += (-pointer.y - camera.position.y) * ease;
  camera.lookAt({ x: 0, y: 0, z: 0 });
});
```

- With the pointer over the canvas, the camera moves up to 1.5 units to each side and 1 unit up or down. Screen y runs down and 3D y runs up, hence the minus.
- At 60 frames a second, each frame covers 4% of the distance left, so the camera slows down as it arrives. Multiplying by `ticker.deltaTime`, 1 at that rate and 2 at 30, keeps the pace about the same at any frame rate.
- A {@link Camera3D} looks along its own -Z axis, and {@link Container3D#lookAt | lookAt} turns that axis back to the origin after every move, so the camera swings around the middle of the scene.

Move the pointer over the preview, or drag on a touch screen, and the camera swings with it. To react to the pointer over the shapes themselves, see [Interaction](../../../../src/events/__docs__/interaction.md).
