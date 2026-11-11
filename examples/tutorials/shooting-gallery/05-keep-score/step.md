---
title: Keep score
---

Hits should count. In this step you'll show the score twice: in 2D in the corner of the screen, and in 3D on a board over the booth.

`index.ts` now calls `createScore` in `score.ts`, and adds a point for every hit with `score.add(1)`. The starting code has the `score` object, which keeps the points and calls `show` when they change. Work in `createScore`.

## The score in 2D

2D content goes on the stage as usual. The view is already there, so a `Text` added now draws over it. Put one in the top left corner:

```ts
const hud = new Text({
  text: '',
  style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xffffff },
});

hud.position.set(20, 16);
app.stage.addChild(hud);
```

## A board in the booth

A 3D mesh can show 2D content too. A {@link ContainerTexture} is a texture that a PixiJS `Container` is drawn into. Draw the board in 2D, then put the texture on a plane over the awning:

```ts
const board = new Container();
const digits = new Text({
  text: '',
  style: { fontFamily: 'system-ui, sans-serif', fontSize: 80, fontWeight: '800', fill: 0xffc46b },
});

digits.anchor.set(0.5);
digits.position.set(256, 64);
board.addChild(
  new Graphics().rect(0, 0, 512, 128).fill(0x1b1430).rect(8, 8, 496, 112).stroke({ color: 0xffc46b, width: 6 }),
  digits,
);

const texture = new ContainerTexture({ container: board, width: 512, height: 128, renderer: app.renderer });
const sign = new Mesh3D({
  geometry: new PlaneGeometry({ width: 2.4, height: 0.6 }),
  material: new FlatMaterial({ baseColorTexture: texture }),
});

sign.position.set(0, 6.3, 1.7);
view3d.root.addChild(sign);
```

- The texture is 512 × 128 pixels and the plane 2.4 × 0.6 units, the same shape, so the board isn't stretched. A {@link PlaneGeometry} faces +z, toward the camera.
- The texture takes `board` out of any parent it had, as its {@link ContainerSourceOptions#container | container}, so don't add it to the stage too: that takes it out of the texture, which then captures nothing.
- The board's background fills the whole texture. On an opaque material, {@link BaseMaterial3D#alphaMode | the default}, any part the container leaves empty shows black; [Rendering 2D into 3D](../../../../src/core/__docs__/container-texture.md#empty-space) has the other ways round it.
- {@link FlatMaterial} ignores the lights, so the board shows its own colours, like a lit sign.

## Show the score

Fill in `show`, which writes the score in both places:

```ts
const show = () => {
  hud.text = `Score ${score.points}`;
  digits.text = String(score.points);
  texture.render();
};
```

A `ContainerTexture` doesn't redraw by itself. {@link ContainerTexture#render | render} draws the container into it again. The score changes only on a hit, so redrawing then, and not on every frame, saves work.

Hit a few targets and watch both scores count up.
