---
title: Environment and IBL
description: Light a scene from its surroundings with a sky gradient or a cube map, draw a background behind it, and set tone mapping, exposure and fog.
category: environment
---

# Environment and IBL

A {@link DirectionalLight} lights a scene from one direction. Real places also get light from everywhere else: the sky, the ground, the walls of a room. The view's {@link View3D#environment | environment} adds that light from all around, and it's what shiny surfaces reflect. That light casts no shadows, not even from a sun in a photo of the sky, so add a {@link DirectionalLight} with {@link Light#castShadow | castShadow} for those.

{@link Material3D}, the material most glTF models load with, takes both its light and its reflections from the environment. {@link PhongMaterial} takes its light from it but doesn't reflect it, and {@link FlatMaterial} ignores it. A view has no environment by default, so a metal looks dark apart from its highlights, and an {@link AmbientLight} doesn't brighten it; see [Lights](./lights.md#ambient-light).

[Environment light](/3d/examples?example=lighting_environment) lights a metal PixiJS logo from nothing but its environment, and switches it between a cube map, a sky and ground gradient and a single colour.

## A sky and ground gradient

A {@link Hemisphere} is the simplest environment: a sky colour and a ground colour. A surface facing up takes the sky colour, one facing down takes the ground colour, and the sides blend the two. It needs no image and costs less to draw than a cube map, as the [checklist for phones](../../__docs__/concepts/performance.md#checklist-for-phones) notes.

The view reads the object every frame, so keep a reference to it and change its colours or {@link Hemisphere#intensity | intensity} whenever you like, such as to fade from day to dusk:

```ts
import type { Hemisphere } from '@pixi/3d';

const sky: Hemisphere = { skyColor: 0x8ec5ff, groundColor: 0x8a6a4a };

view3d.environment = sky;

// Later, at dusk
sky.skyColor = 0xff8f6b;
sky.groundColor = 0x3a2a55;
sky.intensity = 0.8;
```

## A cube map

A cube map is six square images of the surroundings, one for each side of a cube around the scene. Lighting a scene from one is called image-based lighting, or IBL. Surfaces pick up the colours around them, and shiny ones reflect a picture of the place, sharp on smooth surfaces and blurred on rough ones. `@pixi/3d` adds a {@link loadCubemap | loader} to `Assets` for `.cubemap` files, which list the six images:

```ts
import { Assets } from 'pixi.js';
import type { CubeTexture } from 'pixi.js';

const sunset = await Assets.load<CubeTexture>('https://pixijs.com/assets/3d/venice-sunset/venice-sunset.cubemap');

view3d.environment = sunset;
```

[Environment light](/3d/examples?example=lighting_environment) lights a metal PixiJS logo with this cube map, between a chrome ball that shows its reflections and a matte one that shows its soft light.

On the first frame that lights a scene with a cube map, PixiJS 3D makes a copy of it, at most 256 pixels wide per face, that lighting and reflections read, so faces wider than 256 pixels sharpen the background but not the reflections. Making the copy takes GPU time once for each cube map, as [How a frame renders](../../__docs__/concepts/rendering.md#when-shaders-compile) notes. On WebGL2 it needs the `EXT_color_buffer_float` extension, and rendering throws on a device without it; [WebGL and WebGPU](../../__docs__/concepts/webgl-and-webgpu.md#what-your-code-handles) covers such a device.

## Loading cube maps

A `.cubemap` file is JSON that names an image for each face, with paths relative to the file:

```json
{
  "right": "px.jpg",
  "left": "nx.jpg",
  "top": "py.jpg",
  "bottom": "ny.jpg",
  "front": "pz.jpg",
  "back": "nz.jpg"
}
```

`right`, `top` and `front` are the +X, +Y and +Z sides. A camera looking down -Z, as the default camera does, sees `back` straight ahead.

A JPG sky stops at white, so its sun is no brighter than a white cloud. A Radiance `.hdr` panorama, the format sites such as Poly Haven publish their skies in, keeps light brighter than white. A JPG panorama loads as a flat texture, which `environment` doesn't take, but `Assets.load` turns an `.hdr` one into a cube map:

```ts
const sky = await Assets.load<CubeTexture>('venice_sunset_1k.hdr');

view3d.environment = sky;
view3d.background = sky;
```

The conversion runs on the main thread while the file loads and blocks the page for a moment; {@link loadHdr} gives timings.

[HDR environment](/3d/examples?example=lighting_hdr-environment) splits the screen between the Venice sunset as an `.hdr` and the same sunset as a `.cubemap` of six JPGs, with a metal logo in each half. Two stops darker, the `.hdr` sun still burns in the metal's reflection, and the JPG one has gone grey.

Destroying a view, or switching it to another environment, doesn't free a cube map or its copy. To free one you loaded, call `Assets.unload` with its URL once no view uses it, such as after you destroy the view, and for a background you replaced, only after the view has drawn a frame with another background that isn't `null`. That frees the cube, its images and the copy:

```ts
await Assets.unload('https://pixijs.com/assets/3d/venice-sunset/venice-sunset.cubemap');
```

## The background

{@link View3D#background | background} draws behind the scene. It takes a cube map, a hemisphere or a plain colour. With none, the default, the 2D content behind the view shows through, as [View3D](../../__docs__/concepts/view3d.md#2d-behind-and-over-a-view) describes.

Give it the same object as the environment and the sky you see matches the light on the scene. They can differ, too: this view lights its model with the sunset but draws a quiet gradient behind it, to keep the eye on the model:

```ts
const view3d = new View3D({
  autoResize: true,
  environment: sunset,
  background: { skyColor: 0x2b2738, groundColor: 0x0d0c12 },
});
```

The background sits infinitely far away, so moving the camera never changes it, and turning the camera shows another part of it. Leave it `null` with an [orthographic camera](./cameras.md#orthographic-cameras), one where nothing shrinks with distance, and give the app a background colour instead.

## Tone mapping and exposure

Lighting can make a colour brighter than the screen's white. {@link View3D#toneMapping | toneMapping} decides how the view turns the scene's light into screen colours. Under the default, `'none'`, anything past white clips, and at an exposure of 1 a colour you give a {@link FlatMaterial}, a {@link Sprite3D} or a plain background draws exactly as it would in 2D. A filmic curve such as `'aces'` rolls bright light off smoothly instead, but it shifts colours on the way, unlit ones too: a white background draws light grey. {@link ToneMapping} lists the curves.

A curve suits a scene lit by a bright sky or strong lights; keep `'none'` where the 3D should match your 2D art. Changing it later can stall a frame while new shaders compile, as [How a frame renders](../../__docs__/concepts/rendering.md#when-shaders-compile) explains, so set it when you create the view.

{@link View3D#exposure | exposure} multiplies the scene's light before the curve, background and fog included. It's free to change every frame. Photographers count exposure in stops, where each stop doubles the light:

```ts
view3d.exposure = 2 ** stops; // -1 halves the light, +1 doubles it
```

## Fog

{@link View3D#fog | fog} fades surfaces toward a colour as they get farther in front of the camera, which hides where the scene ends. The fog doesn't reach the background, so give the background the same colour, and fully fogged surfaces then meet it with no seam whatever the tone mapping and exposure. Distances count from the camera, so set them from how far the camera is from what it frames:

```ts
const view3d = new View3D({
  autoResize: true,
  background: 0x14131c,
  fog: { type: 'linear', color: 0x14131c, near: distance, far: distance + 12 },
});
```

The app's own `background` colour matches the fog only under the default tone mapping at an exposure of 1.

Fog reaches the model too once it's farther than `near` in front of the camera, so with an {@link OrbitCamera} that zooms out, start `near` past its {@link OrbitCamera#maxDistance | maxDistance} plus the model's radius. A floor's edge shows unless it stays past `far` wherever the camera goes. The farther off the fade starts, the thinner the strip it fills at the horizon, and a floor much brighter or darker than the fog then ends in a hard band; give the fog a colour close to the floor's lit colour.

{@link Fog#type | type} picks a {@link FogType}. `'linear'`, the default, runs from no fog at `near` to full fog at `far`. `'exponential'` and `'exp2'` thicken with {@link Fog#density | density} instead, which is 0 by default, so give them one or they show no fog.

The view keeps the object you assign, so changing its colour or distances later is free. Its `type` is read-only, so assign a new object to switch curves, or `null` to turn fog off. Turning fog on or off, or switching its curve, can stall a frame while shaders compile, as a change of tone mapping can. A material created with {@link BaseMaterial3DOptions#fog | fog} set to `false` ignores the fog.

## Next steps

- [Lights](./lights.md): the direct lights an environment fills in around.
- [PBR materials](../../materials/__docs__/pbr.md): how metalness and roughness decide what a surface reflects.
- [Post-processing](../../post-processing/__docs__/post-processing.md): effects such as bloom, which work on the scene's light before tone mapping.
