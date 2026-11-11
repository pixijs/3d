---
title: Put 2D on top
---

A 3D view is one display object on the PixiJS stage, so ordinary 2D content mixes with it. In this step you'll write a headline over the shapes, then add a second, blurred view behind them for depth.

## A headline

`index.ts` now calls `addHeadline` in `headline.ts`. Add two lines of `Text` to the stage:

```ts
const title = new Text({
  text: 'Floating Shapes',
  style: { fontFamily: 'system-ui, sans-serif', fontWeight: '800', fill: 0x2a1b4d },
});
const subtitle = new Text({
  text: 'Made with PixiJS 3D',
  style: { fontFamily: 'system-ui, sans-serif', fontWeight: '500', fill: 0x6b5a99 },
});

title.anchor.set(0.5);
subtitle.anchor.set(0.5);
app.stage.addChild(title, subtitle);
```

The stage draws its children in order, so text added after the view draws over it.

Size the text for the screen and centre it, now and whenever the window resizes:

```ts
const layout = () => {
  const size = Math.min(84, app.screen.width / 10);
  const x = app.screen.width / 2;
  const y = app.screen.height / 2;

  title.style.fontSize = size;
  title.position.set(x, y - size * 0.25);
  subtitle.style.fontSize = size * 0.32;
  subtitle.position.set(x, y + size * 0.55);
};

layout();
app.renderer.on('resize', layout);
```

The renderer emits `resize` each time `resizeTo` resizes the canvas.

## A blurred view behind

Now add a background layer: a second view with a few shapes of its own, far away and out of focus. Add it in `index.ts` where the starting code marks the spot, before the existing view, so that it draws behind:

```ts
const far = addView(app);
const blur = new BlurFilter({ strength: 6 });

blur.repeatEdgePixels = true;
far.filters = [blur];
far.camera.position.z = 20;
addShapes(app, far, 10, 'far');
followPointer(app, far);
```

- A view takes 2D filters like any display object, and `BlurFilter` blurs everything the far view draws. [View3D and the 2D/3D bridge](../../../../src/__docs__/concepts/view3d.md) covers filters, masks and several views.
- `repeatEdgePixels` makes the blur repeat the pixels at the screen's edges. Without it, the blur mixes in the empty space past the edges, and they fade toward the application's background.
- The far camera stands twice as far back. `addShapes` fits the ring to what that camera sees, so the far shapes spread across the screen like the near ones but look smaller, and they move less when the camera follows the pointer.
- A different seed gives the far view its own layout.

The far view now draws the sky, and the near view would paint its own sky over it. Take the sky out of the near view, after its `addView`:

```ts
view3d.background = null;
```

A view with no {@link View3D#background | background} draws only its shapes, so the far view shows through around them.

The preview now has a headline in the middle, sharp shapes around it, and soft shapes drifting further back.
