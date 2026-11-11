---
title: WebGL and WebGPU
description: How to get WebGPU or WebGL2, what your code handles for each, and where each one culls.
category: core-concepts
---

# WebGL and WebGPU

PixiJS 3D draws with whichever GPU renderer PixiJS starts: WebGPU or WebGL2. Scenes, materials, lights and events use the same API on both.

## Choosing a renderer

Ask for WebGPU with PixiJS's `preference` option. PixiJS starts WebGPU where the browser has it and falls back to WebGL2 where it doesn't. Leave `preference` out and PixiJS tries WebGL2 first, even in a browser that has WebGPU.

On WebGPU, PixiJS 3D needs a GPU with the `'indirect-first-instance'` feature, and on a GPU without it `app.init` throws rather than falling back to WebGL2. To fall back on those GPUs too, check for the feature before you start:

```ts
import { Application, RendererType } from 'pixi.js';

const app = new Application();
const adapter = await navigator.gpu?.requestAdapter();

await app.init({
  preference: adapter?.features.has('indirect-first-instance') ? 'webgpu' : 'webgl',
  resizeTo: window,
});

const isWebGPU = app.renderer.type === RendererType.WEBGPU;
```

`app.renderer.type` tells you which one started. To try a scene on WebGL2 in a browser that has WebGPU, start PixiJS with `preference: 'webgl'`.

[Installation](../getting-started/installation.md#how-the-backends-load) covers how each renderer's code loads, and what to import when you start PixiJS with `skipExtensionImports: true`.

## What your code handles

These are the differences you're most likely to meet:

- **Your own shader code.** A {@link ShaderBit} holds its code twice: `gpu` in WGSL for WebGPU and `gl` in GLSL for WebGL2. Write both, since a bit without one runs none of its code on that renderer, with no error. [Toon and custom materials](../../extras/__docs__/custom-materials.md#adding-your-own-shader-code) shows both.
- **Glass.** On WebGL2, {@link TransmissionOptions | glass} in a view drawn straight onto an opaque canvas, PixiJS's default, refracts nothing. [How glass draws](../../materials/__docs__/physical.md#how-glass-draws) covers two fixes, PixiJS's `useBackBuffer: true` and the view's {@link View3DOptions#composite | composite: true}, and when to pick each.
- **Float textures.** Some features draw into floating-point textures: a cube map, six images of the surroundings, as the view's {@link View3D#environment | environment}, and any post effect whose {@link PostEffectOptions#stage | stage} is `'beforeToneMapping'`, as it is by default for {@link BloomEffect | bloom} and most other built-in effects. On WebGL2, PixiJS 3D draws into those only when the device has the `EXT_color_buffer_float` extension, and rendering throws on a device without it, so leave them out there; [How a frame renders](./rendering.md#the-passes-in-a-frame) shows the check. A {@link Hemisphere} environment still lights the scene on such a device but loses its reflections, so a metal surface that only it lights turns black.
- **Polygon offset.** A material's {@link BaseMaterial3D#state | state}`.polygonOffset` won't reliably keep a mark drawn on a surface, such as a skid mark, in front of that surface. WebGPU ignores it, and on WebGL2 a negative offset can push a mark on a floor seen at an angle behind the floor. Leave it at 0 and lift the mark's geometry a little off the surface, which works on both renderers.

## How each renderer culls

Culling skips meshes outside the camera's frustum, the volume of space it sees, so the GPU never draws them. With the view's default {@link View3D#cull | cull} mode, `'gpu'`, where the test runs depends on the renderer and the browser:

- **WebGPU** tests the meshes in a compute shader, a GPU program that calculates rather than draws.
- **WebGPU in Safari, and in any browser on an iPhone or iPad,** tests them on the CPU instead. That covers a typical scene, and even a {@link BatchedMesh3D} of ten thousand trees whose {@link BatchedMesh3D#cull | cull} is `'gpu'`. Only a far larger batch culls in the compute shader there.
- **WebGL2** has no compute shaders, so it tests on the CPU, in `'gpu'` mode as in `'cpu'`.
- **Blended meshes**, whose material has an {@link BaseMaterial3D#alphaMode | alphaMode} of `'blend'`, are tested on the CPU on both renderers.

Where culling runs on the CPU, it tests every mesh every frame, even when nothing moves, so its cost grows with the number of meshes. {@link CullMode} says when each mode suits.

[Batching and culling](/3d/examples?example=instancing_batching) sets {@link Camera3D#cullFrustum} to the frustum of a scout camera that sweeps round a field of clay pieces, so you can watch culling work from outside. Its pane switches `cull` between `'off'`, `'cpu'` and `'gpu'` and counts the pieces that survive.

## Next steps

- [Performance](./performance.md): draw calls, culling and a checklist for phones.
- [How a frame renders](./rendering.md): the passes a view runs each frame.
