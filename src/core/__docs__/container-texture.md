---
title: Rendering 2D into 3D
description: Draw a PixiJS container onto a 3D surface with ContainerTexture, keep it up to date, and put a whole 3D view inside it.
category: rendering
---

# Rendering 2D into 3D

A {@link ContainerTexture} draws a PixiJS `Container` into a texture, and a material shows that texture the same way it shows an image. That puts 2D content on a 3D surface, such as a score board over a shooting gallery:

```ts
import { ContainerTexture, FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import { Container, Graphics, Text } from 'pixi.js';

const board = new Container();
const digits = new Text({ text: '0', anchor: 0.5, style: { fontSize: 80, fontWeight: '800', fill: 0xffc46b } });

digits.position.set(256, 64);
board.addChild(new Graphics().rect(0, 0, 512, 128).fill(0x1b1430), digits);

const texture = new ContainerTexture({ container: board, width: 512, height: 128, renderer: app.renderer });
const sign = new Mesh3D({
  geometry: new PlaneGeometry({ width: 2.4, height: 0.6 }),
  material: new FlatMaterial({ baseColorTexture: texture }),
});

view3d.root.addChild(sign);
```

The texture stretches over the whole {@link PlaneGeometry | plane}, so give the plane the board's shape. The plane's 2.4 by 0.6 is the board's 512 by 128 scaled down. {@link FlatMaterial} ignores the scene's lights, so the board looks lit from within, like a screen. A lit {@link Material3D} shades it like a poster on a wall. [Container texture](/3d/examples?example=2d3d_container-texture) uses this to put a bouncing PixiJS wordmark and a clock on a monitor's screen.

## The container and its size

The texture takes the container out of any parent it had, so the container no longer draws on the stage. Adding it back to the stage takes it out of the texture, which then captures nothing. To show the same content in 2D as well, build it twice, or show the texture in a [sprite](#texture-orientation).

{@link ContainerSourceOptions#width | width} and `height` set the area the texture captures. That's the rectangle from (0, 0) to (`width`, `height`), as if the container sat on the stage of a canvas that size. Leave both out and the texture sizes itself to the container's contents, measured once when you create it. That works only when the container's own transform, such as its position or scale, is at its defaults. For any other container, give the size.

A `Text` with no `resolution` of its own draws at the renderer's resolution, whatever the texture's {@link ContainerSourceOptions#resolution | resolution} is. Give the texture `resolution: app.renderer.resolution` so the two match. {@link ContainerSourceOptions#antialias | antialias} smooths the edges of 2D shapes drawn into the texture. The application's `antialias` option doesn't apply to them.

## Transparent areas

An opaque material, the default {@link BaseMaterial3D#alphaMode | alphaMode}, draws the container's empty parts black and turns the soft edges next to them hard. To keep those edges smooth, fill the container's background, as the board above does, or set {@link ContainerSourceOptions#clearColor | clearColor} to `'black'`. For gaps you can see through, such as rounded corners, use `alphaMode: 'blend'`.

## Updating the texture

The texture doesn't redraw itself unless you turn on `autoUpdate`, described below. With a `renderer`, the texture draws once when you create it, unless you turn {@link ContainerSourceOptions#firstRender | firstRender} off. Without one, it stays empty until its first {@link ContainerTexture#render | render}, and an opaque material shows it black. The texture keeps the renderer you give it, in its options or in a `render` call, so later calls can leave it out.

**When the content changes.** A score or a health bar changes far less often than every frame, so render the texture after each change. In between, the surface keeps the last picture and nothing draws the 2D content again:

```ts
function setScore(points: number): void {
  digits.text = String(points);
  texture.render();
}
```

**Every frame.** For content that animates all the time, call `render` from `app.ticker` after you change the container. A callback added to `app.ticker` runs before the application draws, so the surface shows this frame's picture:

```ts
app.ticker.add(() => {
  readout.text = (performance.now() / 1000).toFixed(1);
  texture.render(app.renderer);
});
```

[Container texture](/3d/examples?example=2d3d_container-texture) has a setting that switches between the two. Set to render on change, it renders only when its clock's seconds change, so the bouncing wordmark on the screen falls behind and catches up once a second.

{@link ContainerSourceOptions#autoUpdate | autoUpdate} renders the texture every frame from `Ticker.shared`, once it has a renderer. A default `Application` draws from a ticker of its own, so the surface shows the previous frame's capture. To show the capture in the same frame, create the application with `sharedTicker: true`, or call `render` from `app.ticker` as above.

Call `render` before the application draws. Never call it from code that runs during a render, such as an `onRender` callback.

{@link ContainerTexture#setContainer | setContainer} makes a texture capture another container. The texture keeps its size and GPU memory, so one screen can switch between menus. Render the texture after the switch.

## Clicks on the 2D content

The container isn't on the stage, so pointer events never reach its children. Listen on the mesh instead. With {@link Container3D#hitVolume | hitVolume} set to `'geometry'`, a pointer event's {@link Event3DFields#hit3D | e.hit3D} holds {@link RaycastHit3D#uv | uv}, the mesh's own texture coordinate under the pointer, as [Interaction](../../events/__docs__/interaction.md#3d-event-fields) shows. It's the coordinate before the material's {@link BaseMaterial3D#uvTransform | uvTransform} or a texture's [frame](#several-textures-from-one-container) changes it. On the board above, which has neither, the point in the capture is (`uv.x * width`, `(1 - uv.y) * height`). On a glTF mesh flipped as shown [below](#texture-orientation), it's (`uv.x * width`, `uv.y * height`).

## Texture orientation

The texture stores the container's bottom row first, the other way up from an image. On a {@link PlaneGeometry | plane} without {@link PlaneGeometryOptions#flipV | flipV}, it shows upright, like the board above. [Geometry](../../geometry/__docs__/geometry.md#textures-on-the-built-in-shapes) says how each built-in shape shows it. On a loaded model's mesh, such as a screen in a glTF room, it shows upside down, because glTF starts its texture coordinates at an image's top row. Flip `v`, the vertical texture coordinate, with the mesh material's {@link BaseMaterial3D#uvTransform | uvTransform}, as the crate in Geometry does. This flip and the click point above both need texture coordinates stored as floats, which gltfpack doesn't keep by default. [Mesh quantization](../../assets/__docs__/compression.md#mesh-quantization) says why.

A 2D `Sprite` shows it upside down as well, so flip the sprite:

```ts
import { Sprite } from 'pixi.js';

const preview = new Sprite(texture);

preview.anchor.y = 1;
preview.scale.y = -1; // upright, in the place an unflipped sprite would take
```

A {@link Sprite3D} shows it upside down too, and [Sprite3D](../../scene/__docs__/sprite3d.md#limits) says what to use instead.

## Several textures from one container

A {@link ContainerSource} is the source behind a `ContainerTexture`. Build one yourself to cut several textures from one container with frames, as from a sprite sheet. One `render` of the source updates them all. Because the bottom row comes first, a frame's `y` counts up from the container's bottom edge:

```ts
import { ContainerSource } from '@pixi/3d';
import { Rectangle, Texture } from 'pixi.js';

// icons is 256 by 256, with two 128-pixel icons along its top
const sheet = new ContainerSource({ container: icons, width: 256, height: 256, renderer: app.renderer });
const play = new Texture({ source: sheet, frame: new Rectangle(0, 128, 128, 128) }); // top left
const pause = new Texture({ source: sheet, frame: new Rectangle(128, 128, 128, 128) }); // top right
```

## Nesting a View3D

A {@link View3D} is a 2D display object, so it can go in the container, and the texture then shows its 3D scene. To nest one scene inside another:

- Size the view to the texture with `width` and `height`, not {@link View3D#autoResize | autoResize}, which sizes a view to the canvas even inside a texture.
- The picture already includes the inner scene's lighting, so show it with a `FlatMaterial`, which doesn't light it again.
- Render the innermost texture first, so each texture captures the latest picture of the ones inside it.
- A texture can't appear inside the container it captures, so give each level its own texture.

For a second angle on the same scene, such as a security monitor, use a second camera instead, as [Second cameras](../../scene/__docs__/second-cameras.md#a-camera-that-draws-into-a-texture) shows.

## Cleaning up

{@link ContainerTexture#destroy | destroy()} leaves the texture's `ContainerSource` alive, and if `autoUpdate` is on, the source keeps rendering every frame. `destroy(true)` frees the source and its GPU memory and stops `autoUpdate`. Either way the container survives, unless you pass `{ container: true }`, which destroys the container and its children along with the source.

```ts
texture.destroy(true);
```

{@link BaseMaterial3D#destroy | Destroying a material} with `texture: true` destroys the texture but leaves its source alive in the same way. Add `textureSource: true` to free the source too. {@link Destroy3DOptions} says how a mesh passes these flags to its material.

## Next steps

- [View3D and 2D content](../../__docs__/concepts/view3d.md#world-to-screen): the other way to mix 2D into a scene, a 2D label pinned over a 3D object.
- [Materials](../../materials/__docs__/materials.md#transparency): the alpha modes that decide what the texture's empty parts show.
