---
title: Post-processing
description: Add effects such as bloom, ambient occlusion and antialiasing to a view, turn them on and off, and write an effect of your own.
category: extras:post-processing
children:
  - ./custom-passes.md
---

# Post-processing

A post effect works on the picture a view has drawn, for looks such as a glow around bright lights, darker creases and corners, or smoother edges. The built-in effects come from `@pixi/3d/extras`, and you add them to the view's {@link View3D#passes | passes} list, the extra steps it takes as it draws a frame:

```ts
import { View3D } from '@pixi/3d';
import { BloomEffect } from '@pixi/3d/extras';

const view3d = new View3D({
  autoResize: true,
  passes: [new BloomEffect({ threshold: 0.7, intensity: 1.8 })],
});
```

A PixiJS filter on the view gets only the picture as the screen will show it. A post effect can also read the scene's depth, the distance to the surface at each pixel, which is how ambient occlusion finds corners. And it can run before tone mapping, the step that turns the scene's light into the colours the screen shows, while a lamp can still be brighter than white for bloom to pick out.

## The passes list

The view copies the array you give it, so pushing to that array later changes nothing. Assign a new array instead, as you would a container's `filters`:

```ts
import { SsaoEffect } from '@pixi/3d/extras';

view3d.passes = [new SsaoEffect(), ...view3d.passes];
```

Each effect runs at a {@link PostEffect#stage | stage}: `'beforeToneMapping'` works on the scene's light, and `'afterToneMapping'` on the picture as the screen shows it. The view runs the `'beforeToneMapping'` effects, then tone mapping, then the `'afterToneMapping'` effects, each group in array order, so `[new FxaaEffect(), new BloomEffect()]` still runs FXAA after bloom. [Stacking effects](/3d/examples?example=post_effect-stack) shows when order matters. While a `'beforeToneMapping'` effect is on, the view draws its scene into a floating-point texture, which can hold light brighter than white. On WebGL2, rendering then throws on a device without the `EXT_color_buffer_float` extension; [How a frame renders](../../__docs__/concepts/rendering.md#the-passes-in-a-frame) shows how to check for it.

**Turning an effect on and off.** Set its {@link Pass3D#enabled | enabled} to `false` and the view stops running it. Each flip rebuilds the view's render graph, its list of drawing steps, on the next render, and can recompile the scene's shaders, as [When shaders compile](../../__docs__/concepts/rendering.md#when-shaders-compile) lists. That suits a settings switch, not a flip every frame.

An effect's other properties, such as {@link BloomEffect#intensity | intensity} or {@link TintEffect#tint | tint}, are values its shader reads, so changing them every frame is cheap. An `intensity` of 0 hides an effect, but it still runs; `enabled = false` saves its cost.

**Antialiasing.** An enabled post effect makes the view draw its scene into a texture first, as [View3D](../../__docs__/concepts/view3d.md#resolution-and-composite-mode) explains, and that texture keeps the canvas's `antialias`. One case loses it: a pass that has the scene draw an extra texture the GPU can't average, such as {@link SsaoEffect} with {@link SsaoEffectOptions#sceneNormals | sceneNormals: true} on WebGL, leaves the scene's edges jagged; {@link SceneOutput} lists the formats that do this. For that view, or a canvas without `antialias`, add an {@link FxaaEffect}, last among the `'afterToneMapping'` effects, so it smooths the finished picture. [Anti-aliasing](/3d/examples?example=post_antialiasing) shows each case.

**Cleaning up.** Replacing the list, or destroying the view, never destroys what's in it, since one effect can serve several views. Call {@link Pass3D#destroy | destroy} on each effect or pass you retire.

## Built-in effects

| Effect                   | What it does                                                                     | Stage by default      |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------- |
| {@link BloomEffect}      | Bright parts of the picture glow into their surroundings.                        | `'beforeToneMapping'` |
| {@link SsaoEffect}       | Ambient occlusion: darkens creases, corners and the places where objects meet.   | `'beforeToneMapping'` |
| {@link TiltShiftEffect}  | Keeps a band of depth sharp and blurs the rest, so the scene looks like a model. | `'beforeToneMapping'` |
| {@link MotionBlurEffect} | Streaks opaque meshes as the camera moves or turns.                              | `'beforeToneMapping'` |
| {@link FxaaEffect}       | Smooths jagged edges.                                                            | `'afterToneMapping'`  |
| {@link TintEffect}       | Multiplies the picture by a colour, as `Container.tint` does in 2D.              | `'afterToneMapping'`  |

### Bloom

By default, {@link BloomEffect} works on the scene's light, so at its default {@link BloomEffect#threshold | threshold} mostly what's brighter than white glows, such as an emissive glow with a `strength` above 1, as [PBR materials](../../materials/__docs__/pbr.md#glow) shows. Lower the threshold to make bright but ordinary surfaces glow too. [Bloom](/3d/examples?example=post_bloom) shows where the default threshold cuts.

### Ambient occlusion and tilt-shift

Use both with a camera in its default perspective {@link Camera3D#mode | mode}, not an orthographic one, which draws far things as large as near ones.

{@link SsaoEffect#radius | SsaoEffect.radius}, how far around each point it looks for surfaces that block light, is in world units, so set it for the size of your scene. On a phone, create it with {@link SsaoEffectOptions#resolution | resolution: 1}, which works out the occlusion once per CSS pixel: a quarter as many pixels as at the examples' resolution of 2.

{@link TiltShiftEffect#focalDepth | TiltShiftEffect.focalDepth} is a distance straight out from the camera, so set it to about the camera's distance from what should stay sharp. Zooming an {@link OrbitCamera} changes that distance; when the subject sits at the orbit's {@link OrbitCamera#target | target}, keep it sharp with `orbit.on('change', () => (tiltShift.focalDepth = orbit.distance))`. {@link TiltShiftEffect#debug | debug} paints the sharp band and the blurred zones instead of blurring, to help you place them.

### Motion blur

{@link MotionBlurEffect} blurs by the camera's motion alone: turning or moving the camera streaks opaque meshes, though not the view's background, while a car driving past a still camera stays sharp. On a camera cut, such as a respawn, call the camera's {@link Camera3D#resetHistory | resetHistory}, so the jump doesn't smear the first frame of the new shot.

[Motion blur](/3d/examples?example=post_motion-blur) circles the camera round a ring of clay posts: the posts near its path streak, the logo at the centre of the orbit stays nearly sharp, and a top spinning beside the logo never smears.

### FXAA

{@link FxaaEffect} smooths the edges it finds in the finished picture, but it can't join up a line thinner than a pixel, which the picture has already broken into dashes. In [Anti-aliasing](/3d/examples?example=post_antialiasing), turn the canvas's `antialias` off and FXAA on to see both in a loupe.

## Mesh passes

A {@link MeshPass} goes in the same `passes` list. Rather than change the finished picture, it draws the meshes that join it a second time: an {@link OutlinePass}, for one, draws them again as ink outlines. A mesh joins by the pass's name, usually through its material's `passes` option or {@link BaseMaterial3D#enablePass | enablePass}, which join every {@link Mesh3D} that shares the material, or through {@link Mesh3D#enablePass | its own enablePass}. A {@link BatchedMesh3D} slot ignores its material's passes.

```ts
import { Material3D } from '@pixi/3d';
import { OutlinePass } from '@pixi/3d/extras';

view3d.passes = [...view3d.passes, new OutlinePass({ width: 0.04 })];

const toy = new Material3D({ baseColor: 0xe94f37, passes: { outline: true } }); // every Mesh3D with this material

crate.enablePass('outline'); // this mesh only
```

[Passes per mesh](/3d/examples?example=post_passes-per-mesh) outlines one of several meshes that share a material, and takes a mesh out of the `'opaque'` pass so only its shadow draws. [Toon and custom materials](../../extras/__docs__/custom-materials.md#outlines) covers outlines, and [Debugging](../../extras/__docs__/debugging.md#wireframes) covers {@link WireframePass}, which draws meshes again as lines. A `MeshPass` with a `camera` can draw the scene from a second camera, for a security monitor or a minimap, as [Second cameras](../../scene/__docs__/second-cameras.md#a-camera-that-draws-into-a-texture) shows.

## Writing an effect

A post effect runs a function, `effect(uv)`, once for every pixel of the picture. Subclass {@link PostEffect} and give it that function as its `fragment`, in WGSL for WebGPU and GLSL for WebGL2. `uv` runs from 0 to 1 across the view, and `sampleColor(uv)` reads the picture so far. This vignette darkens the picture toward its edges:

```ts
import { PostEffect } from '@pixi/3d';
import type { EffectFragment, PostEffectOptions } from '@pixi/3d';
import { UniformGroup } from 'pixi.js';

const vignetteFragment: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let color = sampleColor(uv);
  let edge = smoothstep(0.3, 0.8, distance(uv, vec2<f32>(0.5)));
  return vec4<f32>(color.rgb * (1.0 - edge * fx.uStrength), color.a);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 color = sampleColor(uv);
  float edge = smoothstep(0.3, 0.8, distance(uv, vec2(0.5)));
  return vec4(color.rgb * (1.0 - edge * uStrength), color.a);
}
`,
};

class MyVignetteEffect extends PostEffect {
  protected override readonly uniforms = new UniformGroup({ uStrength: { value: 0.6, type: 'f32' } });
  protected readonly fragment = vignetteFragment;

  constructor(options: PostEffectOptions = {}) {
    super({ stage: 'afterToneMapping', ...options });
  }

  public get strength(): number {
    return this.uniforms.uniforms.uStrength as number;
  }

  public set strength(value: number) {
    this.uniforms.uniforms.uStrength = value;
  }
}

view3d.passes = [new MyVignetteEffect()];
```

- The `uniforms` are the effect's settings, read as `fx.<name>` in WGSL and as plain `<name>` in GLSL. PixiJS uploads their values every frame, so a setter only has to write the value.
- An effect runs at `'beforeToneMapping'` unless its constructor passes another stage to `super`. The vignette darkens the picture as the screen shows it, so it passes `'afterToneMapping'`, and spreads `options` after it so one instance can still pick its own.
- The fragment can also call helpers such as `sampleDepth(uv)` and `viewPos(uv)`, which read the scene's depth, and `texel()`, the size of one pixel in `uv` units. {@link EffectFragment} lists them all.
- Which way `uv.y` runs on screen differs between WebGL and WebGPU, so don't make an effect depend on it.

An effect that needs more than one drawing step, as bloom does, overrides {@link PostEffect#build | build} instead; [Custom render passes](./custom-passes.md#effects-in-several-steps) shows how, and [Custom effect](/3d/examples?example=post_custom-effect) runs one beside a vignette.

## Next steps

- [Custom render passes](./custom-passes.md): effects in several steps, and mesh passes with a shader of your own.
- [How a frame renders](../../__docs__/concepts/rendering.md#the-passes-in-a-frame): where each stage runs in a frame.
- [Performance](../../__docs__/concepts/performance.md#checklist-for-phones): keeping post effects few on phones.
