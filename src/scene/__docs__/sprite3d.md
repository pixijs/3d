---
title: Sprite3D
description: Textured cards in a 3D scene that turn to face the camera, with their size, anchor, billboard modes, transparency, sprite sheet frames and draw calls.
category: scene
---

# Sprite3D

A {@link Sprite3D} is a flat textured card in a 3D scene. Like a 2D sprite, it takes its size from its texture and has an `anchor`, a {@link Sprite3D#tint | tint} and an `alpha`. By {@link Sprite3DOptions#billboardMode | default} it also turns to face the camera, which 3D calls billboarding. Use it for trees, glows, markers over characters and flat stand-ins for distant models.

## Creating a sprite

`new Sprite3D` takes one options object: the sprite's own options, plus the ones every {@link Container3D} takes, such as `position`.

```ts
import { Sprite3D } from '@pixi/3d';
import { Assets } from 'pixi.js';

const texture = await Assets.load('https://pixijs.com/assets/bunny.png');
const bunny = new Sprite3D({ texture, height: 1 });

bunny.position.set(0, 1, 0);
view3d.root.addChild(bunny);
```

As on a 2D sprite, `new Sprite3D(texture)` is short for `{ texture }`, and {@link Sprite3D.from} takes anything `Texture.from` accepts. Move or size a new sprite before it first draws, as the snippet above does, or it draws as a 1-unit square. Unless you pass a `material`, the sprite draws with an unlit {@link FlatMaterial} of its own, so lights don't change its colours.

## Size

A sprite's size is its texture's size in pixels times {@link Sprite3DOptions#pixelSize | pixelSize}, the world units per pixel, times its `scale`. The default of 0.01 makes a 512-pixel image 5.12 units across.

To size it in world units instead, pass {@link Sprite3DOptions#width | width} or `height`, and the other follows the image's aspect ratio; pass both to stretch it. Afterwards, the {@link Sprite3D#width | width} and {@link Sprite3D#height | height} properties set one axis each by writing `scale`, as on a 2D sprite:

```ts
const tree = new Sprite3D({ texture: treeTexture, height: 4 }); // the width follows the image

tree.height = 6; // taller, and the width stays as it was
```

## Anchor

{@link Sprite3D#anchor | anchor} is the point of the image that sits on the sprite's position, as in 2D, but on a texture with no `defaultAnchor` it defaults to the centre, not the top-left corner. `{ x: 0.5, y: 1 }` stands a `'cylindrical'` or `'none'` sprite on its position; a `'spherical'` one drifts, as [Facing the camera](#facing-the-camera) says.

## Facing the camera

The GPU turns a sprite to face the camera as it draws it, so your code never has to. {@link Sprite3DOptions#billboardMode | billboardMode} picks how, or whether:

- `'spherical'`, the default, keeps the card flat to the screen from every angle, for glows, sparks and icons. It ignores the sprite's `rotation`, so a spark can't spin like a 2D sprite; [particles](../../extras/__docs__/particles.md#options) can. An anchor away from the centre drifts as the camera moves, so keep these sprites centred.
- `'cylindrical'` turns the card about its up axis only, so it stays upright when the camera looks down on it, for trees, grass and characters.
- `'none'` draws the card as you place it, facing its local +Z, for signs and decals that keep their own rotation.

[Sprites in 3D](/3d/examples?example=sprites_sprite3d) puts the three modes side by side; orbit and watch which sprites turn to follow you.

A sprite that faces the camera ignores a negative `scale.x`, so it can't flip the way a 2D sprite does. Flip the image instead, with a mirrored copy of its texture:

```ts
import { Texture, groupD8 } from 'pixi.js';

const facingLeft = new Texture({ source: walk.source, frame: walk.frame, rotate: groupD8.MIRROR_HORIZONTAL });

hero.texture = facingLeft;
```

Picking, the 3D hit test behind pointer events, tests the unturned card rather than the one you see; [Interaction](../../events/__docs__/interaction.md#hit-volumes) shows how to give a sprite a shape that's easy to click.

### Billboards on any mesh

A {@link Mesh3D} can face the camera too: set its {@link Mesh3D#billboardMode | billboardMode} and build the card facing +Z. Turn its {@link Mesh3D#castShadow | castShadow} off, for the reason [Shadows](#shadows) gives.

## Transparency

A sprite blends by {@link Sprite3DOptions#alphaMode | default}, which suits soft edges such as glows. The view sorts blended meshes back to front every frame, by distance rather than child order, as [Materials](../../materials/__docs__/materials.md#transparency) explains. For hard-edged images such as leaves, set `alphaMode: 'mask'`: it cuts away pixels below {@link Sprite3DOptions#alphaCutoff | alphaCutoff} and draws the rest solid, so the sprites skip that sort.

{@link Sprite3D#alpha | alpha} fades only a blended sprite: on a masked sprite, lowering it cuts more of the image away until none is left, and an `'opaque'` sprite ignores it. A sprite has no `blendMode`; for glows that add light, as `'add'` does in 2D, use [particles](../../extras/__docs__/particles.md#options).

## Shadows

A light draws a billboard's shadow from the unturned card, so the shadow can thin to a sliver. That's why a sprite casts no shadow by {@link Sprite3DOptions#castShadow | default}. With `castShadow: true`, a sprite in `'none'` mode casts once it's masked or opaque and its front faces the light. A masked one's shadow doesn't show its holes yet, as [Shadows](./shadows.md#which-meshes-cast-and-receive) says.

## Sharing a material

Pass a `material` and the sprite draws with it, taking its image, and so its size, from the material's base colour texture. A {@link Material3D} makes a lit sprite that the view's [lights](./lights.md) shade, as a flat stand-in for a lit model needs.

Many sprites can share one material:

```ts
import { FlatMaterial, Sprite3D } from '@pixi/3d';

const material = new FlatMaterial({ baseColorTexture: bunnyTexture, alphaMode: 'mask' });

for (let i = 0; i < 1000; i++) {
  const bunny = new Sprite3D({ material });

  bunny.position.set(Math.random() * 10 - 5, 0, Math.random() * 10 - 5);
  view3d.root.addChild(bunny);
}
```

They then draw together on both renderers, but they share one look: `texture`, `tint`, `alpha`, `alphaMode` and `alphaCutoff`, set on any of them or passed as options, write into the material, so a change through one sprite reaches all of them. Destroying a sprite leaves a material you passed alone by {@link Sprite3D#destroy | default}, and destroys the one it made for itself.

## Sprite sheets

There's no 3D `AnimatedSprite`: assigning another {@link Sprite3D#texture | texture} swaps the frame and resizes the sprite to it. Frames of one sprite sheet share its `TextureSource`, so switching between them keeps the sprite in the same draw call. This flipbook swaps frames cut from one sheet in the ticker:

```ts
import { Sprite3D } from '@pixi/3d';
import { Rectangle, Texture } from 'pixi.js';

const frames = [0, 1, 2, 3].map((i) => new Texture({ source: sheet.source, frame: new Rectangle(i * 64, 0, 64, 64) }));
const pulse = new Sprite3D({ texture: frames[0], pixelSize: 1 / 10 });

pulse.position.y = 3.5;
view3d.root.addChild(pulse);

app.ticker.add(() => {
  pulse.texture = frames[Math.floor((performance.now() / 1000) * 9) % frames.length];
});
```

Pack sprite sheets for 3D without trimming, since a trimmed frame doesn't draw right on a `Sprite3D`. On a shared material, the frame belongs to the material, so animate frames on sprites that have their own.

## Draw calls

Sprites can draw together in one call only when they share, among other things, a billboard mode, an alpha mode, a material class and a texture source; [Performance](../../__docs__/concepts/performance.md#what-makes-a-draw-call) has the full rules. Tint, alpha, size and position can all differ. So put the images of one kind of sprite on one sheet.

Blended sprites draw back to front, and each change of billboard mode or texture source along that order starts another draw call, so give each blended effect one mode and one sheet.

Each sprite is a scene node. [Choosing a node for many objects](./scene.md#choosing-a-node-for-many-objects) says how many that suits, and when {@link BatchedMesh3D} slots or particles do better.

## Limits

- Treat a sprite as a leaf. Its children inherit its texture size, so a child's `x = 1` is one sprite width, not one unit. Put the sprite and what goes with it in a {@link Container3D} instead.
- A {@link ContainerTexture} shows upside down on a sprite. For 2D content that faces the camera, put it on a `Mesh3D` with a {@link PlaneGeometry} and a `billboardMode`. For a label that keeps its size on screen, draw it in 2D over the view, as [View3D](../../__docs__/concepts/view3d.md#from-the-3d-world-to-the-screen) shows.

## Next steps

- [Particles](../../extras/__docs__/particles.md): cards that emit, move and fade on their own.
- [Batched meshes](./batched-mesh.md#cards-that-face-the-camera): more cards than sprites suit, as slots of one node.
- [Performance](../../__docs__/concepts/performance.md): what lets meshes share a draw call.
