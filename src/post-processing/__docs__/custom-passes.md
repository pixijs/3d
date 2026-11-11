---
title: Custom render passes
description: Draw meshes again with a shader of your own, write an effect in several steps, and build a view's render graph yourself.
category: extras:post-processing
---

# Custom render passes

A view draws each frame as a list of passes, its render graph, each drawing one part of the picture: the shadows, the opaque meshes, one step of an effect. Each item in {@link View3D#passes | view3d.passes} is a {@link Pass3D}, and when the view builds its graph, each enabled item adds its own passes at its {@link Pass3D#stage | stage}, the point in the frame where they run. [Post-processing](./post-processing.md) covers the built-in items and effects made of one shader.

## Drawing meshes again

A {@link MeshPass} draws every mesh that joins it a second time, with a shader of its own. Meshes join it by its name, as [Mesh passes](./post-processing.md#mesh-passes) shows. {@link OutlinePass} is one, named `'outline'`: it draws each mesh again in one flat colour, as a shell pushed out along its normals, the directions its surface faces. A white rim around the mesh under the pointer, beside the black ink outlines it draws on the meshes that join `'outline'`, takes a second pass. A second `OutlinePass` makes the view throw, since it's named `'outline'` too, so give a `MeshPass` a name of its own:

```ts
import { MeshPass, stateFor3D } from '@pixi/3d';
import { OutlinePass, solidMeshDescriptor } from '@pixi/3d/extras';

// Culls the front faces instead of the back, as OutlinePass does, so the mesh hides all of the shell but a rim
const shell = stateFor3D();

shell.clockwiseFrontFace = true;

view3d.passes = [
  new OutlinePass(),
  new MeshPass({
    name: 'highlight',
    descriptor: { shaderDescriptor: solidMeshDescriptor({ color: 0xffffff, extrude: 0.06 }), state: shell },
  }),
];

mesh.eventMode = 'static';
mesh.onpointerenter = () => mesh.enablePass('highlight');
mesh.onpointerleave = () => mesh.disablePass('highlight');
```

- **A name of your own needs a shader**, from the pass's `descriptor` or from a material's entry for that name in its {@link BaseMaterial3DOptions#passes | passes} option. {@link solidMeshDescriptor} draws in one flat colour, fixed when you create it. The first hover can stall while the pass's shader compiles, as [When shaders compile](../../__docs__/concepts/rendering.md#when-shaders-compile) describes.
- **Give the pass a `state` too.** Left to the material's state, a pushed-out shell covers the whole mesh, and an opaque mesh's second draw with no `extrude` lands exactly on the first, where the depth test, which keeps only what's nearer than what's already there, rejects it. Cull the front faces of a shell as above. For a draw with no `extrude`, turn `depthTest` off to draw over what's already there.
- **Names are limited.** Every view on the page shares a limited number of name slots, and a name past the last joins nothing, so use a few fixed names rather than one per object. {@link RenderPassBit} has the details.

## Effects in several steps

An effect that needs several steps, unlike the one-function effect in [Writing an effect](./post-processing.md#writing-an-effect), overrides {@link PostEffect#build | build} and adds a {@link FullscreenPass} for each step: one draw of an `effect(uv)` function over the whole picture, which samples the textures in its `reads` and draws into its `writes`. A blur costs less in two steps, across and then down: five samples per pixel in each, ten in all, rather than twenty-five in one:

```ts
import { FullscreenPass, PostEffect } from '@pixi/3d';
import type { EffectFragment, EffectIO, RenderGraph } from '@pixi/3d';

// Averages five pixels in a line, `d` apart
function blurFragment(gpuStep: string, glStep: string): EffectFragment {
  const sum =
    'sampleColor(uv - 2.0 * d) + sampleColor(uv - d) + sampleColor(uv) + sampleColor(uv + d) + sampleColor(uv + 2.0 * d)';

  return {
    gpu: `fn effect(uv: vec2<f32>) -> vec4<f32> { let d = ${gpuStep}; return (${sum}) / 5.0; }`,
    gl: `vec4 effect(vec2 uv) { vec2 d = ${glStep}; return (${sum}) / 5.0; }`,
  };
}

const blurAcross = blurFragment('vec2<f32>(inputTexel().x, 0.0)', 'vec2(inputTexel().x, 0.0)');
const blurDown = blurFragment('vec2<f32>(0.0, inputTexel().y)', 'vec2(0.0, inputTexel().y)');

class MyBlurEffect extends PostEffect {
  public override build(graph: RenderGraph, io: EffectIO): void {
    const across = graph.createColor();

    graph.addPass(
      new FullscreenPass({ renderer: io.renderer, fragment: blurAcross, reads: { color: io.input }, writes: across }),
    );
    graph.addPass(
      new FullscreenPass({ renderer: io.renderer, fragment: blurDown, reads: { color: across }, writes: io.output }),
    );
  }
}

view3d.passes = [new MyBlurEffect()];
```

- `io.input` is the picture so far, and the last step draws into {@link EffectIO#output | io.output}.
- {@link RenderGraph#createColor | graph.createColor()} makes a texture the size of the scene for the steps in between. It lasts one frame, so don't expect last frame's result in it.
- `inputTexel()` is the size of one pixel of the step's input in `uv` units. {@link EffectFragment} lists the other helpers.

## Scene outputs and textures you keep

An effect can also read a {@link SceneOutput | scene output}: an extra texture the scene draw writes beside its colour, such as {@link normalOutput}, each surface's normal. An item that lists one in its {@link Pass3D#requiredOutputs | requiredOutputs} makes the scene write it, and reads it in `build` with {@link RenderGraph#getSceneOutput}. Some formats, `normalOutput`'s on WebGL among them, cost the scene its antialiasing, as [The passes list](./post-processing.md#the-passes-list) says. Like a texture from `createColor`, an output lasts only for the frame. {@link ExtractPass} copies one into a texture you keep, such as one a sprite shows:

```ts
import { ExtractPass, normalOutput } from '@pixi/3d/extras';
import { Sprite } from 'pixi.js';

const normals = new ExtractPass({ output: normalOutput });

view3d.passes = [normals];
app.stage.addChild(new Sprite(normals.texture));
```

[Scene outputs](/3d/examples?example=post_scene-outputs) defines two outputs of its own, each surface's base colour and its distance from the camera, and shows them beside `normalOutput` in three cards. Its see-through sphere is blended, so it shows in none of them.

To keep a result of your own past the frame, write it into a texture you own and add it to the graph with {@link RenderGraph#importColor | graph.importColor}, which takes a function that returns it, such as `() => myTexture`. The graph never clears it. A `FullscreenPass` can't sample it yet, though, since that throws, so show or read it outside the graph, as a sprite shows `ExtractPass`'s texture.

## How a graph runs passes

To add passes other than a `MeshPass` or a `PostEffect`, subclass {@link Pass3D} and add them in its {@link Pass3D#build | build}, at one of the three scene stages ({@link SceneStage}), as [A sky in the feed](../../scene/__docs__/second-cameras.md#a-sky-in-the-feed) does. {@link RenderGraph#addPass | graph.addPass} takes a pass such as a `FullscreenPass`, or a plain object with a `name`, a `setup` and a `render`. These rules hold for both:

- **A pass runs only when something needs what it writes.** Its `setup` runs once, when you add it, and declares through the {@link PassBuilder} which textures it reads and writes. Each frame, the graph runs it only when a later pass that runs reads what it writes, or when it writes the view's own target (usually the screen), a texture you imported or a camera's render texture. A pass that declares nothing never runs. One that only reads, such as a readback to the CPU, calls {@link PassBuilder#sideEffect | b.sideEffect()} in `setup` to run anyway.
- **Passes run in the order you add them,** whatever they declare, so a pass that reads a texture sees only what earlier passes wrote.
- **Each frame,** a pass's {@link GraphRenderPass#condition | condition} can skip it; one that runs gets its `prepare`, then its `render`. {@link GraphRenderPass} says when each runs, and {@link RenderGraph#getTexture} covers a pass that binds a texture itself.
- **A pass that draws no meshes takes `bit:` {@link RenderPassBit.NONE},** so any number of them can share a view.
- **Make handles in `build` or `setup`, never in a constructor.** A handle, from `createColor` or the `PassBuilder`, stands for a texture the graph supplies each frame, and works only in the graph that made it. Each rebuild, such as after you assign `view3d.passes` or flip a pass's {@link Pass3D#enabled | enabled}, starts a new graph and calls each enabled item's `build` again.
- **The graph destroys the passes `build` added** when the view replaces it or is destroyed. The item itself is yours to destroy, as [The passes list](./post-processing.md#the-passes-list) says, so free what it made outside the graph in an override of {@link Pass3D#destroy | destroy}.

## A graph of your own

The {@link View3DOptions#graph | graph} option replaces the view's graph with one your function builds, which the view calls on the first render and again on each rebuild. To add passes no stage can place, start from {@link createDefaultGraph3D} and add to its graph. To draw something else entirely, build a bare {@link RenderGraph}, which runs only the passes you add. This one draws the opaque meshes in white into a texture, a silhouette mask with no shadows, sky or lighting, and a sprite shows it:

```ts
import { Camera3D, ForwardRenderPass, RenderGraph, View3D } from '@pixi/3d';
import { solidMeshDescriptor } from '@pixi/3d/extras';
import { RenderTexture, Sprite } from 'pixi.js';

const mask = RenderTexture.create({ width: 384, height: 384 });
const maskCamera = new Camera3D({ renderTexture: mask });

maskCamera.position.set(0, 1.5, 7);
maskCamera.lookAt({ x: 0, y: 0.3, z: 0 });

const view3d = new View3D({
  width: 384,
  height: 384,
  graph: (renderer, options) => {
    const graph = new RenderGraph({
      globalTextureBindings: options.globalTextureBindings,
      defaultColor: (session) => session.defaultTarget.colorTexture,
      defaultDepth: (session) => session.defaultTarget.depthStencilTexture!,
    });

    graph.addPass(
      new ForwardRenderPass({
        renderer,
        name: 'opaque',
        sort: 'key',
        camera: maskCamera,
        descriptor: { shaderDescriptor: solidMeshDescriptor({ color: 0xffffff }) },
      }),
    );

    return graph;
  },
});

view3d.root.addChild(maskCamera);
app.stage.addChild(view3d, new Sprite(mask));
```

- The {@link ForwardRenderPass} is named `'opaque'`, so it draws the meshes whose materials put them in the opaque pass, with the shader in its `descriptor` rather than the materials' own.
- It draws from the mask's camera, so place and move that camera; no pass here draws from `view3d.camera`, so moving it changes nothing. That camera has a render texture, so the view itself puts nothing on screen, and the sprite shows the texture.
- Give a pass's `descriptor` a whole {@link ShaderDescriptorOptions | shader descriptor}, such as the one {@link solidMeshDescriptor} returns, since a pass has no default {@link ShaderBitTemplate | template}, the shader source that shader bits, small pieces of shader code, fill in. [Toon and custom materials](../../extras/__docs__/custom-materials.md#adding-your-own-shader-code) covers writing shader bits.

## Next steps

- [Post-processing](./post-processing.md): the built-in effects and mesh passes.
- [How a frame renders](../../__docs__/concepts/rendering.md#the-passes-in-a-frame): where each stage runs in a frame.
- [Debugging](../../extras/__docs__/debugging.md#recording-frames): record frames to see the passes the view built, which ones it skipped, and what each read and wrote.
