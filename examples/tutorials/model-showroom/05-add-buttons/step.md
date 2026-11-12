---
title: Add buttons
---

The 3D view is one display object on the stage, so PixiJS 2D content can go over it. In this step you'll build a row of buttons that switch the fox's animations.

`index.ts` now calls `addButtons` in `buttons.ts` instead of cycling through the animations. Work in `addButtons`. `WIDTH`, `HEIGHT` and `GAP` at the top set the size of a button and the space between two.

## Make the buttons

Each button is a `Container` holding a `Graphics` background and a `Text` label. Put them in a row, in one container you can move as a whole:

```ts
const bar = new Container();

app.stage.addChild(bar);

const buttons = clips.labels.map((label, i) => {
  const background = new Graphics();
  const text = new Text({
    text: label,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: '600', fill: 0xffffff },
  });
  const button = new Container();

  text.anchor.set(0.5);
  text.position.set(WIDTH / 2, 0);
  button.addChild(background, text);
  button.x = i * (WIDTH + GAP);

  button.eventMode = 'static';
  button.cursor = 'pointer';
  button.on('pointertap', () => {
    clips.play(label);
    draw();
  });

  bar.addChild(button);

  return { label, background };
});
```

- The bar goes on the stage after the view, so it draws over the 3D scene, as [View3D and 2D content](../../../../src/__docs__/concepts/view3d.md#2d-behind-and-over-a-view) explains.
- A button over the view takes the press itself, so a drag that starts on a button doesn't turn the camera.

## Draw them

Fill the button of the active animation in pink, and give the others a dark, see-through fill with an outline:

```ts
const draw = () => {
  for (const { label, background } of buttons) {
    const active = label === clips.current;

    background
      .clear()
      .roundRect(0, -HEIGHT / 2, WIDTH, HEIGHT, HEIGHT / 2)
      .fill({ color: active ? 0xd81b60 : 0x1d1a24, alpha: active ? 1 : 0.6 })
      .stroke({ color: 0xffffff, alpha: active ? 0 : 0.6, width: 1.5 });
  }
};
```

## Lay them out

Centre the row near the bottom of the screen, and scale it down when the screen is too narrow for it:

```ts
const layout = () => {
  const width = buttons.length * (WIDTH + GAP) - GAP;
  const scale = Math.min(1, (app.screen.width - 32) / width);

  bar.scale.set(scale);
  bar.position.set((app.screen.width - width * scale) / 2, app.screen.height - 48);
};

draw();
layout();
app.renderer.on('resize', layout);
```

The renderer emits `resize` each time `resizeTo` resizes the canvas, so the row follows the window.

Tap a button to change what the fox is doing.
