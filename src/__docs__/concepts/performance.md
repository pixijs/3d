---
title: Performance
description: What puts meshes in one draw call, how a view culls, and a checklist for keeping a 3D scene fast on phones.
category: core-concepts
---

# Performance

A 3D frame costs CPU time to tell the GPU what to draw, and GPU time to shade every pixel.

## What makes a draw call

A draw call is one request from the CPU to the GPU to draw some triangles, and each one costs CPU time. So PixiJS 3D draws many meshes in one instanced draw call: the GPU draws the same geometry once per mesh, each copy with its own transform and material values. Meshes can share a draw call only when they have all three of these in common:

- **The same {@link Geometry3D} object.** Two `new CubeGeometry()` calls make two geometries and two draws. Create a geometry once and pass it to every mesh that uses it.
- **The same shader and {@link BaseMaterial3D#state | state}**: the program the GPU runs to draw them, and its settings such as blending, depth testing and face culling. The material's class decides the shader, with options that add code to it, such as a normal map, {@link BaseMaterial3D#alphaMode | alphaMode}, {@link BaseMaterial3DOptions#doubleSided | doubleSided} or the {@link Material3DOptions#clearcoat | clearcoat} option group. So does the mesh: bones or morph targets that bend it, a {@link Mesh3D#billboardMode | billboardMode} that turns it to face the camera, and {@link Mesh3D#receiveShadow | receiveShadow} once a light in the view casts shadows.
- **The same texture sources.** A draw binds one set of textures, so materials that sample different images draw separately. Frames cut from one image, such as a sprite sheet's, share its `TextureSource` and count as one. Here 3D differs from pixi's 2D batcher, which mixes several textures in one batch.

Values don't change the shader. Colours, roughness, a clearcoat's strength and transforms are data the shader reads per mesh, so a hundred crates with a hundred colours draw in one call:

```ts
import { CubeGeometry, Material3D, Mesh3D } from '@pixi/3d';

const geometry = new CubeGeometry();

for (let i = 0; i < 100; i++) {
  const crate = new Mesh3D({
    geometry, // one geometry for every crate
    material: new Material3D({ baseColor: Math.random() * 0xffffff, roughness: 0.6 }),
  });

  crate.position.set((i % 10) * 1.5, 0.5, Math.floor(i / 10) * 1.5);
  view3d.root.addChild(crate);
}
```

On WebGL, a change of material never splits meshes that have all three in common. On WebGPU, each material among them takes its own call, so four materials cost four calls; only a large number of materials draw as one again. So share one material between meshes that look the same. To colour a {@link BatchedMesh3D}'s slots apart in one call, give one material [a value per slot](../../scene/__docs__/batched-mesh.md#values-of-your-own-per-slot).

Blended meshes, with `alphaMode: 'blend'`, draw back to front by their distance from the camera, so only meshes next to each other in that order can share a draw.

To count a frame's draws, add {@link GraphDebugOverlay} from `@pixi/3d/extras`, as [Debugging](../../extras/__docs__/debugging.md#recording-frames) shows.

## Many copies of one thing

For hundreds or thousands of copies, [Choosing a node for many objects](../../scene/__docs__/scene.md#choosing-a-node-for-many-objects) compares the nodes built for the job, such as {@link BatchedMesh3D}, which draws copies without a scene node for each.

## Culling

Before it draws, a view skips each mesh whose bounding sphere, a sphere around its geometry, lies wholly beyond one of the six sides of the camera's frustum, the region of space the camera sees. That's culling, and it's on by default, where pixi's 2D `cullable` is off until you turn it on. A mesh with {@link Geometry3DOptions#dynamic | dynamic} geometry, such as a {@link ParticleContainer3D}, is never culled, and a {@link BatchedMesh3D} culls by its own {@link BatchedMesh3D#cull | cull}, which is off by default.

The default {@link View3D#cull | view3d.cull}, `'gpu'`, suits most scenes, and {@link CullMode} says when `'cpu'` or `'off'` suits better. Despite its name, `'gpu'` culls on the CPU in some setups, such as under WebGL2, and there it takes CPU time for every mesh each frame; [WebGL and WebGPU](./webgl-and-webgpu.md#how-each-renderer-culls) says where.

A skinned mesh, one that bones bend, is tested at its bind pose, the pose it was modelled in. An animation that carries it far from that pose can make it vanish near the edge of the screen. If that happens, set `view3d.cull` to `'off'`, which turns culling off for every mesh in the view.

## Checklist for phones

Start the app with a resolution cap, and scale heavy counts down on phones and tablets, as the [BatchedMesh3D](/3d/examples?example=instancing_batched-mesh) example does:

```ts
import { isMobile } from 'pixi.js';

await app.init({
  preference: 'webgpu',
  resizeTo: window,
  resolution: Math.min(window.devicePixelRatio, 2), // shade at most 2 x 2 pixels per CSS pixel
  autoDensity: true,
});

const size = isMobile.any ? 25_000 : 100_000; // slots in a BatchedMesh3D, a quarter as many on a phone or tablet
```

- **Cap the resolution.** Every pixel the view covers is shaded, and a phone with a device pixel ratio of 3 has 9 for each CSS pixel; a cap of 2 shades 4. For a heavy scene, {@link View3D#resolution} lowers the resolution of just the 3D scene, and 2D content stays sharp. That puts the view in [composite mode](./view3d.md#resolution-and-composite-mode), where it draws the scene into a texture first.
- **Turn off `antialias` if a phone still drops frames at the cap.** It smooths edges with several samples per pixel but still runs the shader about once per pixel. The PixiJS [performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips) suggest turning it off on older phones.
- **Choose the view's settings before the first render.** Some, such as {@link View3D#toneMapping | toneMapping}, the step that turns the scene's light into screen colours, are built into the shaders, so a value not used before compiles new shaders, which can stall that frame. [How a frame renders](./rendering.md#when-shaders-compile) lists them.
- **Prefer a {@link Hemisphere} to a cube map** for the view's {@link View3D#environment | environment}, the light and reflections from all around, unless shiny surfaces need to reflect detailed surroundings. A hemisphere is two colours, while a cube map is a texture of six images that {@link Material3D} and {@link PhongMaterial} read on every pixel they shade. No environment, the default, costs least.
- **Turn off {@link Mesh3D#castShadow | castShadow} on floors**, and on anything else whose shadow no one sees: each caster draws again into every shadow map, a depth image of the scene seen from a light, that covers it. By default a directional light fits its map around the casters alone, so a large floor that casts stretches the map and every shadow loses detail. If shadows on a floor that doesn't cast vanish or stop short, set {@link LightShadow#bounds | shadow.bounds} to take the floor in, as [Shadows](../../scene/__docs__/shadows.md#one-box-over-the-scene) shows.
- **Redraw shadows only when they change.** A shadow map redraws every frame by default. Set {@link LightShadow#update | shadow.update} to redraw every few frames, or to `'manual'` to redraw only when you call {@link Light#refreshShadows | refreshShadows}, as [Shadows](../../scene/__docs__/shadows.md#redrawing-less-often) shows. A directional light with {@link LightShadow#cascades | cascades} splits what the camera sees into slices by distance and draws a map for each, so keep cascades few, and give it `'manual'` only while the camera stays still. Without cascades, a shadow doesn't follow the camera, so `'manual'` suits a light and casters that don't move, however the camera moves.
- **Set {@link View3D#shadowFilter | view3d.shadowFilter} to `'hard'`**, which reads the shadow map once per pixel where the default `'pcf'` reads it four times ({@link ShadowFilter}). Also lower the view's {@link ShadowQuality | shadowQuality}: each step down quarters each shadow map's memory and the pixels drawn into it.
- **Give point and spot lights a range** with {@link PointLight#range} and {@link SpotLight#range}. A light without one is shaded on every pixel of every lit mesh, and a light with one only where it reaches, as [Lights](../../scene/__docs__/lights.md#range) explains.
- **Use `alphaMode: 'mask'` rather than `'blend'`** for anything with hard edges, such as leaves, fences and many sprites. A {@link Sprite3D} that makes its own material blends by {@link Sprite3DOptions#alphaMode | default}, and the view sorts blended meshes back to front every frame. Masked meshes draw with the solid ones and skip that sort, so they batch like them.
- **Use {@link FlatMaterial}**, which does no lighting, for anything that needs none, and leave out the option groups a material doesn't use: a group's code stays in the shader even at strength 0.
- **Keep shapes drawn thousands of times simple.** The GPU processes every vertex of a shape once for each copy it draws, so lower a built-in shape's segment counts, such as a {@link ConeGeometry}'s {@link ConeGeometryOptions#radialSegments | radialSegments}, 32 by default.
- **Load compressed models.** Meshopt compression shrinks a model's download, and quantizing it, storing its vertex data as small integers, shrinks it on the GPU too. [Compressed models](../../assets/__docs__/compression.md) shows how.
- **Hide meshes with {@link Container3D#visible | visible}** rather than removing and adding them. A hidden mesh keeps its place in the draw lists, while removing and adding one changes them and costs more CPU time.
- **Don't create objects in the ticker.** {@link Container3D#getGlobalPosition | getGlobalPosition} and {@link View3D#worldToScreen | worldToScreen}, for example, create a new result on each call unless you pass one to fill as `out`. Garbage made every frame can make the browser pause to collect it.
- **Keep post effects few.** An enabled post effect makes the view [draw its scene into a texture first](./view3d.md#resolution-and-composite-mode), and each built-in effect, such as {@link BloomEffect}, draws over the whole picture again. [Post-processing](../../post-processing/__docs__/post-processing.md) covers them.
- **Test on WebGL2 too**, with `preference: 'webgl'`. A browser without WebGPU gets WebGL2, where culling runs on the CPU.

## Next steps

- [WebGL and WebGPU](./webgl-and-webgpu.md): which renderer you get, and where each one culls.
- [How a frame renders](./rendering.md): the passes a view runs, and what rebuilds a shader.
- [Batched meshes](../../scene/__docs__/batched-mesh.md): drawing thousands of meshes from one node.
