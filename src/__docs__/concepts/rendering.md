---
title: How a frame renders
description: The passes a view runs each frame, which of them draw a mesh, and the settings that make the view compile new shaders.
category: core-concepts
---

# How a frame renders

When PixiJS renders the stage and reaches a {@link View3D}, the view draws its whole 3D scene there, then PixiJS carries on with the 2D content after it.

## The passes in a frame

The view draws each frame in passes, each one drawing one part of the picture. This list of passes is the view's render graph, and the passes run in this order:

1. **Shadows.** Lights that cast shadows draw the shadow-casting meshes into their shadow maps, pictures of depth seen from each light. [Shadows](../../scene/__docs__/shadows.md) covers them, and how to redraw them less often.
2. **`'beforeOpaque'` items** in {@link View3D#passes | view3d.passes}. They run before the view draws its scene, so a texture they fill, such as a second camera's feed, shows in the scene on the same frame.
3. **Background and opaque meshes.** The view draws its {@link View3D#background | background}, if it has one, then the opaque meshes. A depth test keeps the surface nearest the camera at each pixel, so unlike 2D, child order doesn't decide which mesh ends up in front. To draw a mesh over the opaque ones, such as a marker that shows through walls, give it a `'blend'` material, so it draws after them, and set that material's {@link BaseMaterial3D#state | state}`.depthTest` to `false` when you create it.
4. **`'afterOpaque'` items.** Glass refracts what they draw into the scene, and transparent meshes draw over it.
5. **A copy of the picture so far**, taken only on frames when a later pass reads it. Glass reads it, so a glass mesh in the scene costs a copy every frame.
6. **Glass, then transparent meshes.** Materials with transmission draw first and refract the copy; [Physical extensions](../../materials/__docs__/physical.md) covers glass. Then come the `'blend'` meshes, sorted from back to front by their distance from the camera rather than by child order, as [Materials](../../materials/__docs__/materials.md#transparency) explains.
7. **`'afterTransparent'` items.** They run after every mesh in the scene and before any post effect.
8. **Post effects.** The `'beforeToneMapping'` effects, then the view's {@link View3D#toneMapping | tone mapping}, which turns the scene's light into the colours the screen shows, then the `'afterToneMapping'` effects.

The view skips the shadow pass while no light casts shadows, and a pass that draws meshes while no mesh in the scene belongs to it, so a scene without shadows or glass pays nothing for them. Hiding a mesh or a light, or moving a mesh off-screen, doesn't skip its passes: a pass whose meshes are all hidden still runs until you remove them from the scene.

Each item in `view3d.passes` runs at the step its {@link Pass3D#stage | stage} names, wherever it sits in the array. [Post-processing](../../post-processing/__docs__/post-processing.md) covers the list, the built-in effects and writing your own effect.

With a `'beforeToneMapping'` effect on, the view draws its scene into a floating-point texture, so those effects see light brighter than white, and applies the tone mapping once, after the last of them, rather than in each material. Transparent meshes and glass then blend with what's behind them before the tone mapping rather than after, so they can look different once you add one.

On WebGL2, rendering throws on a device without the `EXT_color_buffer_float` extension, so check for it before you add a `'beforeToneMapping'` effect such as bloom:

```ts
import { BloomEffect } from '@pixi/3d/extras';
import { RendererType } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';

// WebGPU can always draw into a floating-point texture
const canDrawFloat =
  app.renderer.type !== RendererType.WEBGL ||
  Boolean((app.renderer as WebGLRenderer).context.extensions.colorBufferFloat);

if (canDrawFloat) view3d.passes = [new BloomEffect()];
```

## Which passes draw a mesh

A mesh's material and its own settings decide which passes draw it:

- A material whose {@link AlphaMode | alphaMode} is `'opaque'` or `'mask'` puts its meshes in the opaque pass, and one whose `alphaMode` is `'blend'` puts them in the transparent pass.
- A {@link Material3D} built with {@link Material3DOptions#transmission | transmission} puts them in the transmission pass, where glass draws, instead.
- {@link Mesh3D#castShadow | castShadow} adds the shadow pass, except for a material that blends or has transmission. [Shadows](../../scene/__docs__/shadows.md#which-meshes-cast-and-receive) says which meshes cast.
- A material can join extra passes by name, such as an outline pass, as [Mesh passes](../../post-processing/__docs__/post-processing.md#mesh-passes) shows, and {@link Mesh3D#enablePass | enablePass} adds a single mesh to one.

When a mesh doesn't draw where you expect, its {@link Mesh3D#renderPassMask | renderPassMask} reports the passes that draw it as {@link RenderPassBit} flags. A {@link BatchedMesh3D} doesn't take its passes from its materials: give each object in it those flags through {@link BatchedMesh3D#setPassesAt | setPassesAt}, as [Batched meshes](../../scene/__docs__/batched-mesh.md) shows.

## When shaders compile

A mesh's shader, the program the GPU runs to draw it, is put together from what it needs, such as its material's features, the data its geometry carries, the bones or morph targets that bend it, and a few of the view's settings. Each combination compiles once per renderer and is shared by every mesh that needs it, so the number of shaders grows with the combinations a scene uses, not with its mesh count.

The first frame that needs a new combination compiles it, and that frame can stall, most of all on WebGL. These view settings are built into the shaders of the materials they affect, so changing one makes new combinations, which compile on the next frame:

- {@link View3D#toneMapping | toneMapping}. With a `'beforeToneMapping'` effect on, the materials keep their shaders, and only the shader that applies it to the whole picture compiles.
- {@link View3D#fog | fog}: turning it on or off, or changing its `type`.
- {@link View3D#environment | environment}: switching between none, a {@link Hemisphere} and a cube map (`CubeTexture`). Swapping one cube map for another recompiles no material, but the first frame that uses each cube map spends time preparing it for lighting, once.
- Shadows: the first time a light in the view casts shadows, each mesh that {@link Mesh3D#receiveShadow | receives them} and has a material that reacts to light gets a shader that samples them. It keeps that shader, so turning shadows off and on later compiles nothing. From then on, {@link View3D#shadowFilter | shadowFilter} is built in too.
- {@link View3D#passes | passes}: turning on the first `'beforeToneMapping'` effect or turning off the last, and adding an effect whose {@link Pass3D#requiredOutputs | requiredOutputs} asks the scene draw for extra data, such as {@link MotionBlurEffect}, which reads each pixel's motion.

A mesh also gets a new shader when you change its {@link Mesh3D#billboardMode | billboardMode}, when you give it a geometry that carries different data, such as one without UVs (texture coordinates), and the first time it joins an extra pass that draws with a shader of its own, such as an {@link OutlinePass}. So an outline that {@link Mesh3D#enablePass | enablePass} turns on when the pointer enters a mesh can stall that first hover. A sphere in place of a cube carries the same data and compiles nothing. [Materials](../../materials/__docs__/materials.md#changing-a-material-that-has-rendered) covers what a change to a material needs.

Values the shaders read as data compile nothing when they change: {@link View3D#exposure | exposure}, the fog's colour and distances, a hemisphere's colours, light colours and intensities, and the number of lights. The renderer keeps every combination it has compiled, so a setting switched back and forth compiles only the first time each value is used. Choose the view's settings before the first render where you can, and change them on a loading screen or in a settings menu rather than during play.

```ts
import { View3D } from '@pixi/3d';

// Given here, they're in place when the first render compiles the scene's shaders
const view3d = new View3D({
  autoResize: true,
  environment: { skyColor: 0xc9d2ff, groundColor: 0x2a2140, intensity: 0.9 },
  fog: { type: 'linear', color: 0x14131c, near: 20, far: 34 },
});
```

## Next steps

- [Performance](./performance.md): draw calls, culling and a checklist for phones.
- [Debugging](../../extras/__docs__/debugging.md#recording-frames): recording a view's frames to see its passes and draws.
- [WebGL and WebGPU](./webgl-and-webgpu.md): where the two backends differ.
