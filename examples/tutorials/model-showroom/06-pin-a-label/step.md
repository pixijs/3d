---
title: Pin a label
---

A showroom often points out part of a product with a dot and a tag that stay on it as the view turns. In this step you'll pin a 2D tag to the fox's head that shows which animation is playing.

`index.ts` now calls `addHotspot` in `hotspot.ts`. Work in `addHotspot`. `HEAD`, at the top of the file, is a point on the fox's head in the units of the fox's file: 64 up and 40 forward from the model's origin. To find a spot on a model of your own, start from its {@link Container3D#getLocalBounds | getLocalBounds()}, which measures it in those same file units, and adjust by eye.

## Build the tag

A dot for the spot and a line up to a tag with the animation's name, all in one 2D container whose origin is the dot:

```ts
const hotspot = new Container();
const line = new Graphics().moveTo(0, 0).lineTo(36, -60).stroke({ color: 0xffffff, width: 2 });
const dot = new Graphics().circle(0, 0, 5).fill(0xffffff).stroke({ color: 0xd81b60, width: 2 });
const tag = new Container();
const background = new Graphics();
const text = new Text({
  text: '',
  style: { fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: '600', fill: 0x1d1a24 },
});

text.anchor.set(0, 0.5);
text.position.set(14, 0);
tag.position.set(36, -60);
tag.addChild(background, text);
hotspot.addChild(line, dot, tag);
app.stage.addChild(hotspot);
```

## Follow the head

A 2D object can't go inside the 3D scene, but it can follow a point in it. On every frame, find where the head is on the screen and move the hotspot there:

```ts
const world = new Vector3();
const screen = new Point();

app.ticker.add(() => {
  if (text.text !== clips.current) {
    text.text = clips.current;
    background
      .clear()
      .roundRect(0, -16, text.width + 28, 32, 16)
      .fill(0xffffff);
  }

  fox.toGlobal(HEAD, world);
  const point = view3d.worldToScreen(world, screen);

  hotspot.visible = point !== null;
  if (point) hotspot.position.copyFrom(point);
});
```

- {@link Container3D#toGlobal | toGlobal} turns a point in the fox's own space into a point in the scene, through the fox's position, rotation and scale. That's why `HEAD` can stay in the file's units while the fox is scaled down.
- {@link View3D#worldToScreen | worldToScreen} turns a point in the scene into a point on the stage, in the same pixels as `event.global`, so `hotspot`, added straight to the stage, can take it as its position. It returns `null` for a point at or behind the camera, the cue to hide the hotspot.
- `world` and `screen` are made once and filled in every frame, so working out where the head is makes no new objects.

[View3D and the 2D/3D bridge](../../../../src/__docs__/concepts/view3d.md#from-the-3d-world-to-the-screen) covers labels in a moved or scaled container.

Turn the camera, and the dot stays on the fox's head with the tag beside it. Change the animation and the tag changes with it. When the fox runs, its head dips, so for part of each stride the dot hangs just above it: the animation moves the head, and `HEAD` is a fixed point on the model.
