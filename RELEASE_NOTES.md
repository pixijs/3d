### 🚨 Behavior Change

- chore: bump pixi.js peer dependency to 8.23.0 by @Zyie
  ```sh
  npm install pixi.js@^8.23.0
  ```
- feat: views default to toneMapping 'none' by @GoodBoyDigital
  - `View3D` now defaults to `toneMapping: 'none'` instead of `'aces'`. A scene that relied on the default draws its highlights brighter, and lit colour above 1 clips to white instead of rolling off. Unlit materials and a `background` colour now show as authored, where ACES drew white as light grey. To keep beta.2's look, pass `toneMapping: 'aces'` to each view, or set `View3D.defaultOptions.toneMapping = 'aces'` once before you create any view.
  ```ts
  import { View3D } from '@pixi/3d';

  // one view
  const view3d = new View3D({ toneMapping: 'aces' });

  // or every view created after this line
  View3D.defaultOptions.toneMapping = 'aces';
  ```
- feat: post effects read linear light, with the curve in OutputPass by @GoodBoyDigital
  - `PassStage` no longer has `'post'`. Post effects run at `'beforeToneMapping'`, on linear light before the view's tone curve, or at the new `'afterToneMapping'`, on the picture as it shows, and `PostEffect.stage` is one of the two. Replace checks for `'post'`, and replace `Exclude<PassStage, 'post'>` with the new `SceneStage` type, which `MeshPassOptions.stage` and `WireframePassOptions.stage` now take.
  ```ts
  import type { PassStage, SceneStage } from '@pixi/3d';

  // before
  const stage: Exclude<PassStage, 'post'> = 'afterOpaque';
  const isEffect = pass.stage === 'post';

  // after
  const stage: SceneStage = 'afterOpaque';
  const isEffect = pass.stage === 'beforeToneMapping' || pass.stage === 'afterToneMapping';
  ```
  - A custom `PostEffect` runs at `'beforeToneMapping'` unless it says otherwise. Its input is linear light in `rgba16float`, so values can go above 1 and aren't display-encoded. An effect that works on the picture as it shows, such as LUT grading or edge detection, or that shows data such as depth, normals or debug colours, must pass `stage: 'afterToneMapping'` to `super`.
  ```ts
  import { PostEffect } from '@pixi/3d';
  import type { PostEffectOptions } from '@pixi/3d';

  class MyLutEffect extends PostEffect {
    constructor(options: PostEffectOptions = {}) {
      super({ stage: 'afterToneMapping', ...options });
    }
  }
  ```
  - Effects now run grouped by stage: every `'beforeToneMapping'` effect in array order, then the tone curve, then every `'afterToneMapping'` effect in array order. `TintEffect` defaults to `'afterToneMapping'`, so it runs after `BloomEffect`, `SsaoEffect` and `TiltShiftEffect` wherever it sits in `view.passes`. To keep a tint ahead of them, give it `stage: 'beforeToneMapping'`; it then tints the light instead of the picture.
  ```ts
  import { BloomEffect, TintEffect } from '@pixi/3d/extras';

  // before: the tint ran first because it came first in the array
  view3d.passes = [new TintEffect({ tint: 0xffaa66 }), new BloomEffect()];

  // after
  view3d.passes = [new TintEffect({ tint: 0xffaa66, stage: 'beforeToneMapping' }), new BloomEffect()];
  ```
  - A view with a `'beforeToneMapping'` effect, such as `BloomEffect`, `SsaoEffect`, `TiltShiftEffect` or a custom `PostEffect`, now draws its scene into `rgba16float` linear light. Its `toneMapping` curve then runs once on the whole image after those effects, not in each material. Transparent surfaces blend in linear light before the curve, so they look slightly different. Views without such an effect keep the curve in their materials.
  - `BloomEffect` now reads linear light before the tone curve, so every bloom looks different. Its `threshold` is measured in that light, and the default `1` blooms only what's brighter than white. Retune a threshold set for the old 8-bit image, such as `0.5`.
  - `SsaoEffect` now darkens linear light before the tone curve, so its occlusion looks lighter. Raise `intensity` to match the old look. `TiltShiftEffect` also blurs in linear light now.
  - Glass (a `Material3D` with `transmission`) now decodes the scene behind it with an exact 2.2 gamma instead of squaring it, so it looks slightly different in every view. No code change is needed.
  - In a view with a `'beforeToneMapping'` effect, `OutlinePass`, `WireframePass` and any other `MeshPass` whose own shader writes a flat colour into the scene no longer show the colour you set. The output pass runs the tone curve and display encode over it, so most colours show lighter; black stays black. Under the default `toneMapping: 'none'`, give the pass its colour in linear light, each channel raised to the power 2.2, to get the old colour back. Under a filmic curve, keep coloured outlines and wireframes in views whose effects all run at `'afterToneMapping'`.
  ```ts
  import { Color } from 'pixi.js';
  import { BloomEffect, OutlinePass } from '@pixi/3d/extras';

  const [r, g, b] = new Color(0xff8800).toRgbArray();
  view3d.passes = [new OutlinePass({ color: [r ** 2.2, g ** 2.2, b ** 2.2] }), new BloomEffect()];
  ```
  - On WebGL 2 without `EXT_color_buffer_float`, a view with a `'beforeToneMapping'` effect now throws when it builds its render graph on its first render. To keep the effect working on those devices, run it at `'afterToneMapping'` there.
  ```ts
  import { RendererType } from 'pixi.js';
  import type { WebGLRenderer } from 'pixi.js';
  import { BloomEffect } from '@pixi/3d/extras';

  const renderer = app.renderer;
  const canDrawFloat =
    renderer.type !== RendererType.WEBGL || !!(renderer as WebGLRenderer).context.extensions.colorBufferFloat;
  view3d.passes = [new BloomEffect({ stage: canDrawFloat ? 'beforeToneMapping' : 'afterToneMapping' })];
  ```
  - `graph.createColor()` with no `format` now takes the scene colour's format, which is `rgba16float` in a view with a `'beforeToneMapping'` effect, where it used to take the view target's. Pass `format` to keep a texture 8-bit.
  ```ts
  // before
  const mask = graph.createColor({ label: 'mask' });

  // after
  const mask = graph.createColor({ label: 'mask', format: 'rgba8unorm' });
  ```
  - `DefaultGraph3DOptions.toneMapping` is now required. A custom `graph` builder that passes the `options` it receives on to `createDefaultGraph3D` gets it from the view. A builder that writes its own options object must spread `options` into it; in plain JavaScript, leaving it out shows a view with a `'beforeToneMapping'` effect without its tone curve or display encode.
  ```ts
  import { createDefaultGraph3D } from '@pixi/3d';
  import type { View3DOptions } from '@pixi/3d';

  // before
  const graph: View3DOptions['graph'] = (renderer, options) =>
    createDefaultGraph3D(renderer, { passes: options.passes, composite: true }).graph;

  // after
  const graph: View3DOptions['graph'] = (renderer, options) =>
    createDefaultGraph3D(renderer, { ...options, composite: true }).graph;
  ```
  - Lit material shaders on both backends now define a `decodeToLinear(c)` function. A custom bit that defines a function with that name fails to compile, so rename yours.
  - In a custom `graph` builder, a `sceneColor` with a float or `-srgb` `format`, such as `rgba16float`, now marks the scene as linear light (`RenderGraph.sceneIsLinear`). Materials and the sky then leave out the tone curve and display encode, so the image shows too dark unless a pass in the graph applies them. In beta.2 the materials always applied them. Finish such a graph with an `OutputPass` given the builder's `options.toneMapping`. On such a view, and on any view with a `'beforeToneMapping'` effect, changing `toneMapping` now destroys the render graph and calls the builder again, so don't keep references to the passes it made.
  ```ts
  import { OutputPass, RenderGraph } from '@pixi/3d';
  import type { View3DOptions } from '@pixi/3d';

  const buildGraph: View3DOptions['graph'] = (renderer, options) => {
    const graph = new RenderGraph({
      globalTextureBindings: options.globalTextureBindings,
      defaultColor: (session) => session.defaultTarget.colorTexture,
      defaultDepth: (session) => session.defaultTarget.depthStencilTexture!,
      sceneColor: { label: 'sceneColor', format: 'rgba16float' },
      sceneDepth: { label: 'sceneDepth' },
    });

    // add your passes, then finish the image
    graph.addPass(new OutputPass({ renderer, source: graph.sceneColor, toneMapping: options.toneMapping }));

    return graph;
  };
  ```
- fix: unlit materials show colours as authored by @GoodBoyDigital
  - `BaseMaterial3D.toneMapped` is removed, and every material, lit or unlit, now takes the view's `toneMapping`. Delete `toneMapped` overrides and any reads or writes of it; TypeScript rejects `override toneMapped`. There's no per-material opt-out. Under `toneMapping: 'none'`, the default, unlit art at exposure 1 matches pixi 2D, and under a filmic curve such as `'aces'` it shifts with the lit scene. To keep some art off the curve, draw it in its own `View3D` with `toneMapping: 'none'`.
  ```ts
  // before
  class SkyMaterial extends BaseMaterial3D {
    public override toneMapped = false;
    public override lit = false;
  }

  // after
  class SkyMaterial extends BaseMaterial3D {
    public override lit = false;
  }
  ```
  - `FlatMaterial`, `Sprite3D`, `ParticleContainer3D` and `ParticleSystem3D` particles, `PortalMaterial` and glTF `KHR_materials_unlit` materials now encode their colour inputs for display, so they render differently with no code change. Beta.2 drew their `baseColor`, `tint`, particle `color` and `colorEnd`, vertex colours and glTF unlit factors as linear values (a 128 grey drew as 55). Under `toneMapping: 'none'` at exposure 1 these now draw as authored and match pixi 2D, so everything except pure black and white gets brighter; remove any brightening you added to compensate. Their textures with a white tint draw as before under `'none'`. `view.exposure` now scales them before the display encode, so an exposure of 2 makes them about 1.37 times as bright instead of 2. Fog on an unlit surface now reaches the fog colour, and under `toneMapping: 'custom'` unlit materials write linear light like lit ones.
  - A material that set `toneMapped = false` now ends in the view's curve and display encode like every other, so its shader bits must write linear light into `albedo`. One that wrote display-space colour into `albedo`, such as a sky, now draws too bright. Decode that colour with `decodeColor`.
  ```wgsl
  // before, on a material with toneMapped = false
  albedo *= mix(sampledColor * material.brightness, material.horizonColor, horizonMask);

  // after
  albedo *= decodeColor(mix(sampledColor * material.brightness, material.horizonColor, horizonMask));
  ```
  - A material of your own that composes `portalBit` from `@pixi/3d/extras`, as beta.2's docs suggested, now runs the view's tone curve over the feed a second time under `toneMapping: 'aces'`, `'reinhard'` or `'uncharted2'`, because only `PortalMaterial` can leave the curve out. Build the portal with `PortalMaterial` and pass your own bits as `extraBits`.
  ```ts
  import { PortalMaterial } from '@pixi/3d/extras';

  // before: a material of your own whose descriptor listed portalBit and rippleBit
  // after
  const material = new PortalMaterial({ texture: feed, extraBits: [rippleBit] });
  ```
  - Every material's main-pass shader now defines four colour-space helpers: `decodeColor(c)` for a display colour or texture sample, `inputTint(material.baseColor, material.displayBaseColor)` for the material tint (declare `displayBaseColor: 'vec4<f32>'` beside `baseColor` in `bindings.material`), `decodeFrame(c)` for a frame the view drew, and `inputExposure`, which the material template calls. Rename any function of your own called `decodeColor`, `inputTint`, `decodeFrame` or `inputExposure`. Bits on `FlatMaterial`, `Sprite3D`, particle and portal materials, whose `colorSpace` is `'display'`, run in display space under `toneMapping: 'none'` when no fog, vertex colours or `'beforeToneMapping'` effect reach the mesh, and in linear light otherwise. A bit there that multiplies in a raw texture sample or reads `material.baseColor` directly draws differently on the two paths, so read every colour through the helpers.
  - `srgbToLinear` and `linearToSrgb` now use a pure 2.2 gamma, the curve the shaders already use, instead of the piecewise sRGB curve. Every `ColorSource` the engine decodes (material colours, lights, fog, backgrounds) shifts slightly: mid-tones carry about 2% more linear light and deep darks less. Lit scenes need no code change. If you call these functions and need the exact piecewise sRGB curve, write your own.
  - Particle tints are now stored as authored, in display space. `packParticleColor` and `setParticleAt` pack the bytes unchanged instead of decoding them, the `particleColor` local stays in display space through the vertex stage and is decoded on its way to the fragment stage, and `aColorEnd` takes display-space channels in `[0, 1]`. Code that packs linear bytes for `writePacked`, custom particle bits that write linear values into `particleColor`, and `aColorEnd` values run through `srgbToLinear` must pass the authored values instead. Colour ramps now blend in display space, as a 2D tween does.
  ```ts
  // before
  system.setParticle(i, { aColorEnd: { x: srgbToLinear(1), y: srgbToLinear(0.5), z: 0, w: 1 } });

  // after
  system.setParticle(i, { aColorEnd: { x: 1, y: 0.5, z: 0, w: 1 } });
  ```
  - On `FlatMaterial`, `Sprite3D`, particle and portal materials, a write straight into `material.data.baseColor` misses the display-space path, which reads `material.data.displayBaseColor`. Set `material.baseColor` and `material.alpha` instead; they fill both.
  ```ts
  // before
  material.data.baseColor!.set([1, 0, 0, 0.5]);
  material.update();

  // after
  material.baseColor = 0xff0000;
  material.alpha = 0.5;
  ```
- fix: alphaMode 'opaque' ignores alpha by @Zyie
  - `alphaMode: 'opaque'`, the default, now ignores alpha. Before, alpha below 1 from the `alpha` option, the base colour texture or vertex colours darkened the surface toward black; now it draws at full colour. That covers glTF `OPAQUE` materials, opaque particles' `alpha` and `alphaEnd`, an opaque `Sprite3D`'s `alpha`, and alpha written by `extraBits` or a raw `descriptor`. To fade a surface, use `alphaMode: 'blend'`; to dim it, use a darker `baseColor`.
  ```ts
  // before: alpha darkened the opaque surface
  const panel = new Material3D({ baseColor: 0xffffff, alpha: 0.5 });

  // after: fade it with a blended surface
  const panel = new Material3D({ baseColor: 0xffffff, alpha: 0.5, alphaMode: 'blend' });

  // or dim it with a darker colour
  const panel = new Material3D({ baseColor: 0x808080 });
  ```
  - A `ContainerTexture` on an opaque material now draws hard, stepped edges where its content meets empty space. They faded to black before only because opaque materials darkened by alpha. Pass the new `clearColor: 'black'` option, or set `texture.clearColor` and call `render()`.
  ```ts
  const screen = new ContainerTexture({ container: scoreText, clearColor: 'black', renderer: app.renderer });

  monitor.material = new FlatMaterial({ baseColorTexture: screen });
  ```
  - A camera's `renderTexture` shown on an opaque material steps the same way, since a second camera draws no sky and clears to transparent. Give the view a `background` and draw it into the feed with a `BackgroundPass`, added from a `Pass3D` ahead of the feed's `MeshPass`.
  ```ts
  import { BackgroundPass, MeshPass, Pass3D } from '@pixi/3d';
  import type { Camera3D, PassContext, RenderGraph } from '@pixi/3d';

  class FeedSkyPass extends Pass3D {
    public readonly stage = 'beforeOpaque';

    constructor(private readonly _camera: Camera3D) {
      super();
    }

    public build(graph: RenderGraph, { renderer }: PassContext): void {
      graph.addPass(new BackgroundPass({ renderer, camera: this._camera }));
    }
  }

  view3d.passes = [new FeedSkyPass(feedCamera), new MeshPass({ name: 'opaque', camera: feedCamera })];
  ```
- breaking: CullMode drops 'auto', and views cull on the GPU by default by @GoodBoyDigital
  - `CullMode` is now `'off' | 'cpu' | 'gpu'`; `'auto'` is gone. Replace it with `'gpu'`, or with `'off'` for a view of 300 meshes or fewer or a `BatchedMesh3D` of 300 instances or fewer, which `'auto'` drew unculled. `'gpu'` is the `View3D` default, so a view can drop the option. TypeScript flags `'auto'`. JavaScript doesn't, so search your code for it.
  ```ts
  import { BatchedMesh3D, View3D } from '@pixi/3d';

  // before
  const view = new View3D({ cull: 'auto' });
  const forest = new BatchedMesh3D({ size: 10000, cull: 'auto' });

  // after
  const view = new View3D(); // 'gpu' is the default
  const forest = new BatchedMesh3D({ size: 10000, cull: 'gpu' });
  ```
  - A `View3D` without a `cull` option now defaults to `'gpu'` instead of `'auto'`, so a view of 300 meshes or fewer now culls where it drew everything. Culling tests a skinned mesh at its bind pose, so an animated character that moves far from that pose can vanish near the edge of the screen. Set `cull: 'off'` on a view that shows one, or that always fits in view. `View3D.cull` is no longer read-only, so you can also change it after construction.
  ```ts
  const view = new View3D({ cull: 'off' });

  view.cull = 'off';
  ```
- breaking: a camera's zoom magnifies by its value in both modes by @Zyie
  - An orthographic `Camera3D` now divides `orthographicSize` by `zoom`, so a larger `zoom` magnifies. It used to multiply, so a larger `zoom` showed more of the scene. To keep an old framing, set `zoom` to `1 / oldZoom`.
  ```ts
  // before: zoom 2 showed twice as much of the scene
  camera.mode = 'orthographic';
  camera.zoom = 2;

  // after: zoom 2 magnifies, so set the reciprocal for the old framing
  camera.mode = 'orthographic';
  camera.zoom = 1 / 2;
  ```
  - `OrbitCamera` applies `minZoom` and `maxZoom` only to an orthographic camera's `zoom`, so their meaning flips along with it. To keep the old limits, pass `minZoom: 1 / oldMaxZoom` and `maxZoom: 1 / oldMinZoom`.
  ```ts
  import { OrbitCamera } from '@pixi/3d/extras';

  // view3d.camera is orthographic

  // before
  const orbit = new OrbitCamera({ view: view3d, minZoom: 0.5, maxZoom: 4 });

  // after
  const orbit = new OrbitCamera({ view: view3d, minZoom: 1 / 4, maxZoom: 1 / 0.5 });
  ```
  - With an orthographic camera, `OrbitCamera`'s wheel, pinch and `zoom(factor)` with `factor > 1` now zoom in, as they do with a perspective camera. If you swapped `zoom(1.25)` and `zoom(0.8)` to work around the old direction, swap them back.
  - A perspective `Camera3D` now divides `tan(fov / 2)` by `zoom`, so a zoom of N magnifies exactly N times. It used to divide `fov`, so a zoom of 2 at a 60° `fov` magnified about 2.15x. A zoom of 1 renders as before. To keep an old framing, set `fov` to `oldFov / oldZoom` and `zoom` to 1.
  ```ts
  // before
  camera.fov = 60;
  camera.zoom = 2;

  // after: the same framing
  camera.fov = 30;
  camera.zoom = 1;
  ```
- breaking: load glTF cameras, including orthographic ones by @Zyie
  - glTF and GLB cameras now load, perspective and orthographic. `View3D.from(source)` draws from the file's first camera, with that camera's field of view or `orthographicSize` and its near and far planes. It used to make a new `Camera3D` and frame the model with it. Files without cameras behave as before. To keep a camera of your own, pass it as the `camera` option and position it yourself. Nothing turns the automatic framing back on for a file that has a camera.
  ```ts
  import { Camera3D, View3D } from '@pixi/3d';

  const view = View3D.from(source, { camera: new Camera3D({ fov: 45 }) });
  view.camera.position.set(0, 1, 5);
  ```
  - Each camera node in a `Model3D` is now a `Camera3D` and is listed in `model.cameras`. In v0.1.0-beta.2 it was a plain `Container3D` and `model.cameras` was empty. After `View3D.from`, `view.camera` can be that node inside the model, so `view.camera.position` is in its parent node's space, and setting it overrides where the file placed the camera.
- breaking: Sprite3D takes one options object, like pixi's MeshOptions by @Zyie
  - `Sprite3DTextureOptions`, `Sprite3DMaterialOptions` and `Sprite3DSharedOptions` are removed, and `Sprite3DOptions` is now a single interface instead of a union. Replace those type names with `Sprite3DOptions`. You no longer need to narrow on `options.material` before calling the constructor.
  ```ts
  // before
  import type { Sprite3DTextureOptions } from '@pixi/3d';
  const options: Sprite3DTextureOptions = { texture, alphaMode: 'mask' };

  // after
  import type { Sprite3DOptions } from '@pixi/3d';
  const options: Sprite3DOptions = { texture, alphaMode: 'mask' };
  ```
  - `texture`, `tint`, `alpha`, `alphaMode` and `alphaCutoff` passed with `material` are now written into that material. `texture` goes into its `baseColor` slot and sets the sprite's size. They used to be ignored with a warning, and the old types rejected the mix, so only JavaScript or cast code hits this. On a shared material it changes every sprite that uses it, so pass only `material` to leave a shared material alone.
  ```ts
  import { Material3D, Sprite3D } from '@pixi/3d';

  const leaves = new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask' });

  // no texture, tint, alpha, alphaMode or alphaCutoff, so leaves stays as it is
  const card = new Sprite3D({ material: leaves, billboardMode: 'cylindrical' });
  ```
- fix: normal maps read green-up on meshes without tangents by @GoodBoyDigital
  - A normal map on a mesh without vertex tangents now reads green up, the glTF and OpenGL convention, on both backends and in render textures. That covers the built-in primitives, `Sprite3D`, and glTF models that ship no tangents. Meshes with tangents render as before. On beta.2 these meshes lit their bumps from the wrong side, vertically on the canvas and on WebGPU and horizontally in a WebGL render texture, and the clearcoat normal map and anisotropy on them used the same wrong frame. If you flipped a channel of a map to make it look right on beta.2, or authored a sprite map green-down as the old `Sprite3D` docs said, flip it back. For a DirectX-style (green-down) map, invert the green channel. `normalScale` can't do this, since it scales x and y together.
  - `Material3D` no longer adds `screenSpaceFuncsBit` to every shader. A bit in `extraBits` that calls `screenUVFromWorld` or `sampleScreenCopy` now lists `screenSpaceFuncsBit` in the new `ShaderBit.requires` field. Without it the shader fails to compile, unless the material also uses `transmission`.
  ```ts
  import { screenSpaceFuncsBit } from '@pixi/3d';
  import type { ShaderBit } from '@pixi/3d';

  const waterBit: ShaderBit = {
    name: 'water',
    requires: [screenSpaceFuncsBit],
    // gpu and gl code that calls screenUVFromWorld or sampleScreenCopy, unchanged
  };
  ```
  - `Material3D` and `PhongMaterial` shaders now declare `PI` through `mathConstantsBit`, beside the `INV_PI` they already declared. A custom bit that declares its own `PI` fails to compile with a redeclaration error. Delete the constant and list `mathConstantsBit` in the bit's `requires`, which also gives the bit `PI` and `INV_PI` in any other material.
  ```ts
  import { mathConstantsBit } from '@pixi/3d';
  import type { ShaderBit } from '@pixi/3d';

  // before
  const ringsBit: ShaderBit = {
    name: 'rings',
    gpu: {
      header: 'const PI: f32 = 3.14159265359;',
      fragment: { material: 'albedo *= 0.75 + 0.25 * cos(input.vUV.x * 8.0 * PI);' },
    },
    gl: {
      header: 'const float PI = 3.14159265359;',
      fragment: { material: 'albedo *= 0.75 + 0.25 * cos(vUV.x * 8.0 * PI);' },
    },
  };

  // after
  const ringsBit: ShaderBit = {
    name: 'rings',
    requires: [mathConstantsBit],
    gpu: { fragment: { material: 'albedo *= 0.75 + 0.25 * cos(input.vUV.x * 8.0 * PI);' } },
    gl: { fragment: { material: 'albedo *= 0.75 + 0.25 * cos(vUV.x * 8.0 * PI);' } },
  };
  ```
- fix: skinned meshes ignore their node transform and skins on one rig share a skeleton by @GoodBoyDigital
  - `Model3D.skeletons` now has one entry per distinct skin. Skins that list the same joints and inverse bind matrices, which three.js writes once per mesh of a character built from several meshes, share one `Skeleton`, so the array can be shorter than the file's skin list and its indices no longer match the file's. Read the skeleton from the mesh it deforms with `mesh.skeleton`, or use `model.skeletons[0]` for a single-rig character, and find bones with `skeleton.indexOf()`.
  ```ts
  import type { Mesh3D } from '@pixi/3d';

  // before
  const head = model.skeletons[1].indexOf('Head');

  // after
  const body = model.getChildByLabel('Body', true) as Mesh3D;
  const head = body.skeleton!.indexOf('Head');
  ```
  - A skinned mesh now sits under the lowest node above its skin's joints, the armature in a typical export, instead of directly under the model or where the file put it. Its `position`, `quaternion` and `scale` now hold the skin's bind shape transform, not the identity or the node's own transform, and the bones cancel it. When that transform isn't the identity, setting the mesh's `scale` or `quaternion` replaces it rather than adding to it, so scale or turn the model or the node above the mesh instead. Find skinned meshes with a deep `getChildByLabel(label, true)` instead of searching `model.children`.
  ```ts
  // before
  const body = model.children.find((child) => child.label === 'Body');

  // after
  const body = model.getChildByLabel('Body', true);
  ```
  - A `Skeleton` now stops below the skin's parent node, the lowest node above all its joints. In beta.2 it could also hold the armature and every node above it, so on such a file `skeleton.indexOf('Armature')` now throws, `nodeCount` is smaller and node indices shift. The armature is a `Container3D` in the model instead. Find it with `getChildByLabel()`, and look node indices up with `indexOf()` instead of hard-coding them.
  ```ts
  // before
  const armatureIndex = model.skeletons[0].indexOf('Armature');

  // after
  const armature = model.getChildByLabel('Armature', true);
  ```
  - The glTF `skins[].skeleton` property is now ignored, so a skinned mesh never applies its node transform on top of its joints. A file that sets `skeleton` and puts a transform on the skinned mesh's node now draws differently: three.js exports of FBX characters, which drew 100 times too big and on their side, now draw at their real size and orientation. Remove any scale or rotation you added to the model or the skinned mesh to undo that. A step that deleted `skins[].skeleton` from the file is no longer needed.
  - Bounds, `hitVolume` and `width`/`height`/`depth` on a skinned model now measure each skinned mesh at its bind shape transform under the skin's parent node. On a model whose bind shape transform isn't the identity, `model.width = 2` sets a different `scale` than in beta.2, so check any size you set this way.
- breaking: vertex formats mean what they say, so normalized quantized positions render at size by @GoodBoyDigital
  - `Geometry3D` throws when `positions` or `uvs` is an integer typed array, such as an `Int16Array` or `Uint16Array`. The option types never allowed one, but JavaScript and cast calls ran. Positions used to draw at the stored integers, so `Float32Array.from(positions)` gives the same result. UVs used to read as 0 to 1, so pass them as an `Attribute` with the matching `unorm` or `snorm` format, such as `{ buffer, format: 'unorm16x2' }` for a `Uint16Array`.
  - An integer position `Attribute` now needs `bounds3D`, and `Geometry3D` throws without it, since it computes bounds only from float positions. Give the box in the values the format reads as: within -1 to 1 for `snorm16x4`, the stored integers for `sint16x4`.
  - A position `Attribute` in a `snorm` or `unorm` format now reads as -1 to 1 or 0 to 1, as the format says. The shader used to multiply it back up to the stored integer, so these meshes now render up to 65535x smaller. To keep the old size, switch to the `sint` or `uint` format of the same width, such as `sint16x4` for `snorm16x4`, and give `bounds3D` in stored integers. Or keep the format and scale the node by the type's max, such as 32767 for `snorm16x4`.
  ```ts
  import { Buffer, BufferUsage } from 'pixi.js';
  import { Box, Geometry3D, Vector3 } from '@pixi/3d';

  const data = new Int16Array([0, 100, 0, 0, -100, -100, 0, 0, 100, -100, 0, 0]);
  const buffer = new Buffer({ data, usage: BufferUsage.VERTEX });

  // before
  const geometry = new Geometry3D({ positions: { buffer, format: 'snorm16x4' } });

  // after
  const geometry = new Geometry3D({
    positions: { buffer, format: 'sint16x4' },
    bounds3D: new Box(new Vector3(-100, -100, 0), new Vector3(100, 100, 0)),
  });
  ```
  - glTF files with normalized integer positions, which glTF-Transform's `quantize` and gltfpack's `-vpn` write, now render at their real size, with or without Draco. They used to render too large by the integer type's max, 32767 for 16-bit signed positions, and their `bounds3D` was too large by the same factor. Remove any scale you added to make up for it.
  - glTF files with raw integer positions, gltfpack's default, render as before. Their `aPosition` format is now `uint16x4` or `sint16x4` where it was `unorm16x4` or `snorm16x4`, and the same goes for 8-bit positions. Update any code that checks it.
  - A glTF whose integer `POSITION` accessor has no `min` and `max` now fails to load with an error that names the accessor. The glTF spec requires both, so re-export the file with them.
- feat: antialias follows the canvas through post effects by @GoodBoyDigital
  - A view that draws through post effects or `composite: true` now keeps the canvas's `antialias`. On an app created with `antialias: true`, the scene colour and depth are multisampled, so edges stay smooth through bloom, SSAO and the other effects, unless an attached scene output has a format the GPU can't average (see `SceneOutput`). In beta.2 these views drew single-sample. The view now uses more GPU memory, resolves the scene colour each frame, and copies the scene depth once a frame when a pass samples it. To keep beta.2's single-sample cost, create the app with `antialias: false`, which also turns MSAA off for views without effects and for the 2D scene.
  - A camera whose `Camera3D.renderTexture` was created with `antialias: true` now draws multisampled and resolves into the texture, so the feed has smooth edges. beta.2 ignored the texture's `antialias`. Create the texture without `antialias` to keep the old cost.
  - `GraphDebugPassSnapshot.mipmapHandles` from `@pixi/3d/extras` is renamed `finishedColors`. It holds the same ids, the colours a pass writes last. After the pass, the graph resolves the multisampled ones and generates mipmaps for those with `autoGenerateMipmaps`.
  ```ts
  import { RenderGraphDebugger } from '@pixi/3d/extras';

  const debug = new RenderGraphDebugger({ view: view3d });
  const snapshot = debug.capture();

  // before
  const ids = snapshot?.graph.passes.map((pass) => pass.mipmapHandles);

  // after
  const ids = snapshot?.graph.passes.map((pass) => pass.finishedColors);
  ```
  - In a custom graph, a pass that writes a depth with `b.produce` instead of attaching it now throws when a later pass samples that depth while it's multisampled, as the scene depth is in a composited view on an app with `antialias: true`. The graph resolves a multisampled depth from the target that drew it. Attach the depth in the last pass that writes it with `b.writeDepth`, or create the app with `antialias: false`.
- feat: HDR environments keep their range through the IBL prefilter by @GoodBoyDigital
  - A `CubeTexture` in a float format, such as `rgba16float`, or in an `-srgb` format is now read as linear light, for reflections (`View3D.environment`) and for the sky (`View3D.background`). Before, every cube went through a 2.2 gamma decode as if it held sRGB, so these rendered too dark below white, and a float cube's reflections clipped at 1. Cubes in 8-bit formats, which image files load as, look as before. If you raised `exposure` or pre-encoded a float cube to make up for the old decode, undo it.
  - On WebGL 2, prefiltering a `CubeTexture` environment now needs `EXT_color_buffer_float`. On a device without it, about 0.04% of WebGL 2 browsers, rendering a view with that environment throws; it used to render. To keep those devices working, check for the extension and fall back to a `Hemisphere` environment.
  ```ts
  import { RendererType } from 'pixi.js';
  import type { WebGLRenderer } from 'pixi.js';

  const canPrefilter =
    renderer.type !== RendererType.WEBGL || !!(renderer as WebGLRenderer).context.extensions.colorBufferFloat;

  view3d.environment = canPrefilter ? envCube : { skyColor: 0x88ccff, groundColor: 0x553311 };
  ```
- fix: specular.factor dims environment reflections at grazing angles by @Zyie
  - A `Material3D` with `specular.factor` below 1 now dims its environment reflection at grazing angles as well as head-on, and with `transmission` it lets that light through instead. On beta.2 the edges reflected at full strength, so `specular: { factor: 0 }` still showed the environment around a mesh's silhouette. glTF models that use `KHR_materials_specular` change the same way. Metals, a factor of 1 and materials without `specular` render as before. If you tuned a material on beta.2 to hide those bright edges, undo it.
- breaking: replace the particle seed option with createRandom by @Zyie
  - `ParticleSystem3D`'s `seed` option is gone. Pass `createRandom`, a function that returns a random generator, and build the generator from the old seed with `seededRandom`. TypeScript flags `seed`. JavaScript ignores it, so every run comes out different.
  ```ts
  import { seededRandom } from '@pixi/3d';
  import { ParticleSystem3D } from '@pixi/3d/extras';

  // before
  const sparks = new ParticleSystem3D({ seed: 'campfire' });

  // after
  const sparks = new ParticleSystem3D({ createRandom: () => seededRandom('campfire') });
  ```
  - `gotoAndPlay` and `gotoAndStop` now call `createRandom` on every seek and start a fresh stream, so with the factory above `gotoAndPlay(0)` replays the same particles. With `seed`, a seek carried on the first run's stream, so each replay differed. To keep that, make the generator once and return it from `createRandom`. Assigning `time`, `update()` and `spawn()` keep drawing from the current stream.
  ```ts
  import { seededRandom } from '@pixi/3d';
  import { ParticleSystem3D } from '@pixi/3d/extras';

  const random = seededRandom('campfire');
  const sparks = new ParticleSystem3D({ createRandom: () => random });
  ```
- breaking: BatchedMesh3D.setItemActive is setPassesAt, and a slot that joins a pass is rebuilt for it by @GoodBoyDigital
  - `BatchedMesh3D.setItemActive` is now `BatchedMesh3D.setPassesAt` and takes the same arguments. There's no alias, so rename every call.
  ```ts
  // before
  batched.setItemActive(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);

  // after
  batched.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
  ```
  - A slot that joins a pass now rebuilds its shader and batch keys on the next frame, so adding passes costs more than `setItemActive` did. If you called `setItemActive(i, 0)` and `setItemActive(i, mask)` to despawn and spawn slots, call `setVisibleAt(i, false)` and `setVisibleAt(i, true)` instead, which rebuild nothing. The exception is a blended slot that stays spare for a while: the `TRANSPARENT` pass sorts hidden slots every frame, so take that one out with `setPassesAt`.
- feat: scene update visits only the meshes that changed by @GoodBoyDigital
  - `Mesh3D.updateShadow()` is removed. A mesh now starts or stops casting shadows on its own when its material switches to or from `alphaMode: 'blend'`. Delete the calls, including the ones on `Sprite3D`s.
  ```ts
  // before
  glass.alphaMode = 'blend';
  for (const mesh of glassMeshes) mesh.updateShadow();

  // after
  glass.alphaMode = 'blend';
  ```
- feat: Mesh3D builds without a geometry or material by @Zyie
  - `Mesh3D.morph` is removed and `Morph` is internal. Read and write morph weights through `mesh.weights`, and check `mesh.weights !== undefined` to tell whether a mesh is morphed.
  ```ts
  // before
  if (face.morph) face.morph.weights[smileIndex] = 0.8;

  // after
  if (face.weights) face.weights[smileIndex] = 0.8;
  ```
  - `Mesh3DOptions.geometry` and `Mesh3DOptions.material` are optional now, and so is the `Mesh3D` constructor's `options` argument. Under `strictNullChecks`, code that reads `options.geometry` or `options.material` from a `Mesh3DOptions` value, or uses `Mesh3DOptions['geometry']` as a type, now gets `undefined` in the type, and `ConstructorParameters<typeof Mesh3D>[0]['geometry']` no longer compiles. Type those values as `Geometry3D` and `BaseMaterial3D`.
  ```ts
  import type { Geometry3D, Mesh3DOptions } from '@pixi/3d';

  // before
  function partRadius(geometry: Mesh3DOptions['geometry']): number {
    return geometry.boundsSphere.radius;
  }

  // after
  function partRadius(geometry: Geometry3D): number {
    return geometry.boundsSphere.radius;
  }
  ```
  - `new Mesh3D()` no longer throws when `geometry` or `material` is missing or `undefined`. The mesh holds `Geometry3D.EMPTY` or `BaseMaterial3D.EMPTY` and draws nothing until it has both, so a failed asset lookup now shows up as a missing mesh, not an error. Compare against the two placeholders to find one.
  ```ts
  import { BaseMaterial3D, Geometry3D } from '@pixi/3d';

  if (mesh.geometry === Geometry3D.EMPTY || mesh.material === BaseMaterial3D.EMPTY) {
    console.warn(`${mesh.label} has no geometry or material yet`);
  }
  ```
  - Assigning `mesh.geometry` now resizes `mesh.weights` to the new geometry's morph targets. A geometry with the same number of targets keeps the array, one with a different number gets a new array of zeros, and one with none leaves `weights` `undefined`. Code or an animation that holds the old array no longer drives the mesh after such a swap, so read `mesh.weights` again after assigning the geometry, and check it for `undefined`.
  ```ts
  // before
  const weights = face.weights!;
  face.geometry = lowDetailFace;
  weights[smileIndex] = 0.8;

  // after
  face.geometry = lowDetailFace;
  if (face.weights) face.weights[smileIndex] = 0.8;
  ```
- breaking: remove the general-purpose math helpers by @Zyie
  - Removed the general-purpose math helpers: `randomColor`, `randomRange`, `randomObjItem`, `randomItem`, `randomFloat`, `randomSpread`, `randomInt`, `randomBool`, `randomSign`, `randomShuffle`, `randomHash`, `randomOdds`, `smoothstep`, `smootherstep`, `lerp`, `inverseLerp`, `mapLinear`, `damp`, `euclideanModulo`, `pingpong`, `normalize` and `denormalize`. Copy the ones you use into your own code or use a utility library. `seededRandom` stays, so pass it as the `random` argument of the helpers you copy.
  - `clamp` still imports, but it's now `@internal` and out of the docs, so it can change or go without notice. Keep your own copy instead of importing it.
  ```ts
  // before
  import { clamp, lerp, randomInt } from '@pixi/3d';

  // after
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const lerp = (x: number, y: number, t: number) => (1 - t) * x + t * y;
  const randomInt = (min: number, max: number, random = Math.random) => Math.floor(random() * (max - min + 1)) + min; // max is inclusive
  ```
- breaking: spawn() functions get the particle's place in the batch, not its pool slot by @GoodBoyDigital
  - The second argument of a `ParticleSystem3D.spawn()` override function is now the particle's place in that call, from 0 to `count - 1`, instead of the pool slot it lands in. When `count` is over the capacity, it runs from 0 to `capacity - 1`. Code that indexes its own array with it used to read past the end after earlier spawns, and now works without changes.
  ```ts
  // i runs from 0 to points.length - 1 on every call
  sparks.spawn(points.length, { position: (_rng, i) => points[i] });
  ```
  - Code that saved the old slot to pass to `setParticle()` later has no public replacement, because the system's write cursor is private. To set values when a particle spawns, pass them to `spawn()`, which takes the attributes the system's `extraBits` declare by name. Code that used the argument as an id now gets the same values on every call, so keep a counter of your own.
- feat: View3D.background takes a plain colour by @GoodBoyDigital
  - `View3D.background` now also takes any `ColorSource` and reads a colour back as a hex number, so the getter's type is `CubeTexture | Hemisphere | number | null`. Code that passes `view3d.background` on as a cube map or hemisphere, such as `view3d.environment = view3d.background`, no longer type-checks. Keep your own reference to the cube or hemisphere, or rule out a number first. A cube or hemisphere you assign still reads back as the same object.
  ```ts
  // before
  view3d.environment = view3d.background;

  // after
  if (typeof view3d.background !== 'number') view3d.environment = view3d.background;

  // or keep your own reference
  view3d.background = sky;
  view3d.environment = sky;
  ```
- feat: point and spot lights take a radius by @GoodBoyDigital
  - A custom lighting bit (`createLightingBit`'s `perLight`, or a `lobePerLight` bit) that read `light.range` must read `light.rangeSq`, the range squared, in WGSL and GLSL. `light.range` no longer compiles. 0 still means no range. Take the square root where you need the range itself, or compare `light.rangeSq` with a squared distance as is. The struct's last field is now `light.radiusPow4`, the fourth power of the new `PointLight.radius` and `SpotLight.radius`.
  ```wgsl
  // before
  let range = light.range;
  // after
  let range = sqrt(light.rangeSq);
  ```
  ```glsl
  // before
  float range = light.range;
  // after
  float range = sqrt(light.rangeSq);
  ```
  - Point and spot lights now fall off as `1 / sqrt(d⁴ + radius⁴)`, so at the default `radius` of 0.1 a surface very close to a light gets a little less light than in v0.1.0-beta.2: 29% less at 0.1 away, 3% less at 0.2, and under 1% from 0.3 out. It's never brighter. Most scenes need no change. To brighten the hot spot of a light that sits right against a surface, lower that light's `radius`.
- feat: camera render textures follow the scene in a linear view by @GoodBoyDigital
  - In a view with a `'beforeToneMapping'` effect, the stage where `PostEffect`s such as `BloomEffect` run by default, a camera's 8-bit render texture now holds the finished, tone-mapped picture. A portal that shows that feed through `PortalMaterial` or `PortalPass` puts it through the tone curve a second time, so it looks washed out. Create the portal's feed with `format: 'rgba16float'`. A feed shown on a 2D sprite needs no change.
  ```ts
  import { RenderTexture } from 'pixi.js';
  import { PortalMaterial } from '@pixi/3d/extras';

  // before
  const feed = RenderTexture.create({ width: view3d.width, height: view3d.height });
  // after
  const feed = RenderTexture.create({ width: view3d.width, height: view3d.height, format: 'rgba16float' });

  const portalMaterial = new PortalMaterial({ texture: feed });
  ```
- feat: materials clone with their constructor options changed by @GoodBoyDigital
  - `BaseMaterial3D`'s protected `_extraBits` is now the public readonly `extraBits`. A custom material subclass that reads `this._extraBits`, for example to build its own descriptor, must read `this.extraBits`.
  ```ts
  // before
  const bits = [myMaterialBit, ...this._extraBits];
  // after
  const bits = [myMaterialBit, ...this.extraBits];
  ```
  - `BaseMaterial3D` now has `clone(options?)`, which builds a copy of the same class, typed `this`. A custom material that defined its own `clone()` now overrides it, and TypeScript rejects the override when it returns the class type instead of `this`, as `clone(): MyMaterial` does. Delete yours and use the built-in one, which passes the copied options to your constructor, or rename yours. If the class has constructor options of its own, pass its options type as `BaseMaterial3D`'s third type parameter and override `_toOptions()` to read them back, so `clone()` carries them over.
  ```ts
  import { BaseMaterial3D } from '@pixi/3d';
  import type { BaseMaterial3DOptions, MaterialData, MaterialTextures } from '@pixi/3d';

  interface GlowData extends MaterialData {
    intensity: number;
  }

  interface GlowMaterialOptions extends BaseMaterial3DOptions {
    intensity?: number;
  }

  // before: class GlowMaterial extends BaseMaterial3D, with its own clone(): GlowMaterial
  // after: no clone() of its own
  class GlowMaterial extends BaseMaterial3D<GlowData, MaterialTextures, GlowMaterialOptions> {
    constructor(options: GlowMaterialOptions = {}) {
      super({ ...options, descriptor: { bitsGpu: [glowBit], bitsGl: [glowBit] } });
      this.data.intensity = options.intensity ?? 1;
    }

    protected override _toOptions(): GlowMaterialOptions {
      return { ...super._toOptions(), intensity: this.data.intensity };
    }
  }

  const brighter = glow.clone({ intensity: 2 });
  ```
- breaking: direct draws, steps 1-3: each material binds its own group by @Zyie
  - On WebGPU, each material texture now samples with its own `texture.source.style`, as WebGL already did. In beta.2 every texture shared one sampler that repeated and filtered linearly. A texture left on pixi's default style now clamps to the edge, so a texture you tile, with `uvTransform` for example, stops repeating. A texture with `scaleMode = 'nearest'` or a `maxAnisotropy` now filters that way. Set `addressMode = 'repeat'` on the style of each texture you tile. To change a style after the material has drawn, set the fields on the existing `source.style` and call `style.update()`. WebGPU ignores a new `TextureStyle` assigned to `source.style` until that slot gets a texture with another source.
  ```ts
  import { Assets } from 'pixi.js';
  import { Material3D } from '@pixi/3d';

  const tiles = await Assets.load('tiles.png');
  tiles.source.style.addressMode = 'repeat';

  const floor = new Material3D({ baseColorTexture: tiles });
  ```
  - glTF and GLB textures with no sampler now repeat, as the glTF spec says, instead of clamping to the edge with pixi's default style. On WebGL, models whose UVs run past 0 to 1 render differently. On WebGPU, the wrap and filter settings in a file's samplers, such as clamping or nearest filtering, now take effect. Nothing to change.
  - A custom `ShaderBit` can no longer call `getMaterial(vMaterialIndex)`. Direct draws, one per material, declare no `getMaterial` in WGSL and only a no-argument one in GLSL, so the call fails to compile on both backends. Read the fields through the `material` local, which both stages declare. Nothing replaces reading another material's row by index.
  ```glsl
  // before
  Material m = getMaterial(vMaterialIndex);
  float strength = m.emissiveStrength;
  // after
  float strength = material.emissiveStrength;
  ```
  - In WGSL, a direct draw declares `material` as a read-only `var<uniform>`, where beta.2 declared a local `var`, so a bit that assigns to one of its fields fails to compile. Copy the field into a local and change that. Bits that run later still read the original value.
  ```wgsl
  // before
  material.emissiveStrength *= 2.0;
  // after
  let emissiveStrength = material.emissiveStrength * 2.0;
  ```
  - `sampleBatchSlotGrad`, WGSL's `sampleBatchSlot` and the `uBatchTexture0` to `uBatchTexture9` bindings are gone, so a custom bit that uses them fails to compile. Declare the texture in the bit's `textures`, such as `textures: ['myCustomMap']`, and call its generated getter, `sampleMyCustomMap(uv)` in the fragment stage or `sampleMyCustomMapDirect(uv)` for mip 0 in either stage. No getter takes explicit gradients.
  ```wgsl
  // before
  let mask = sampleBatchSlotGrad(_textureSlots & 0xFu, uv, dpdx(uv), dpdy(uv));
  // after
  let mask = sampleMyCustomMap(uv);
  ```
  - `material.unload()` now also releases the material's bind groups. A `Mesh3D` rebuilds its draw on its own, but a `BatchedMesh3D` slot doesn't watch its material. After unloading a material, call `invalidate(i)` on the batch for each slot that draws it. `Model3D.unload()` unloads the model's materials too, so this also applies to slots that share them.
  ```ts
  material.unload();
  for (const i of leafSlots) trees.invalidate(i);
  ```
- breaking: direct draws, a draw per material with merged runs where they earn it by @GoodBoyDigital
  - `MeshPassOptions` and `ForwardRenderPassOptions` no longer take `textures`, so passing it is a TypeScript error. Delete the option. It only skipped packing work, and a pass you add never binds the mesh's material.
  ```ts
  import { MeshPass } from '@pixi/3d';

  // before
  new MeshPass({ name: 'xray', descriptor: xrayDescriptor, textures: false });
  // after
  new MeshPass({ name: 'xray', descriptor: xrayDescriptor });
  ```
  - The per-instance texture-slot word is gone. `vTextureSlots` on both backends, WGSL's `_textureSlots`, its vertex `textureSlots` local and `RenderableInstance.texSlots` no longer exist, and GLSL's `renderInstance.y` reads 0. A custom bit that reads them fails to compile or reads nothing useful. Sample a texture the bit declares in `textures` through its generated `sample<Name>(uv)` getter instead.
  ```glsl
  // before
  vec4 mask = sampleBatchSlotGrad(vTextureSlots & 15u, uv, dFdx(uv), dFdy(uv));
  // after
  vec4 mask = sampleMyCustomMap(uv);
  ```
  - Meshes and sprites now share a draw only when their materials use the same texture sources. In beta.2 one draw packed up to ten sources, so `Sprite3D`s from separate images drew together. Each image now costs at least one draw, and in a blended pass, whose back-to-front sort interleaves the images, close to one draw per sprite. Within one texture set and geometry, a run draws once per material until it would need more than 16 draws, then merges into one. Pack the images of one blended effect into one sprite sheet so its sprites share draws.
- breaking: WebGL global uniform block and uniform groups declared inside a bind group by @GoodBoyDigital
  - A `ShaderBitTemplate` that lists the `global` bind group must list it as `{ name: 'global', ubo: true }`. A bare `'global'` now throws when the shader compiles, on WebGPU and WebGL, and the error names the entry to use. Change every template you write, such as the `template` of a `ShaderDescriptor`.
  ```ts
  import type { ShaderBitTemplate } from '@pixi/3d';

  // before
  const outlineTemplate: ShaderBitTemplate = {
    bindGroups: ['global', 'camera'],
    gpu: outlineWgsl,
    gl: { vertex: outlineVertex, fragment: outlineFragment },
  };

  // after
  const outlineTemplate: ShaderBitTemplate = {
    bindGroups: [{ name: 'global', ubo: true }, 'camera'],
    gpu: outlineWgsl,
    gl: { vertex: outlineVertex, fragment: outlineFragment },
  };
  ```
  - A bit can no longer declare uniform fields of its own in `global`. On WebGL, `global` is now one uniform block over a fixed buffer, so an extra field makes the draw fail. WebGPU already failed this way. Remove the field. The engine never filled it, so on WebGL it always read 0.
  - On WebGL, `instanceFetchBitGl` now declares `uBatchWorldMatrix` and the global bits don't. A pass's WebGL bit that reads `uBatchWorldMatrix` needs `instanceFetchBitGl` in the pass descriptor's `bitsGl`. A material's own shader already includes it. Delete any `uBatchWorldMatrix` that a bit declares in `global`, since the second declaration now breaks the shader. GLSL still reads the uniform as `uBatchWorldMatrix`.
  ```ts
  import { instanceFetchBitGl } from '@pixi/3d';
  import type { ShaderBit } from '@pixi/3d';

  // before
  const maskBitGl: ShaderBit = {
    name: 'mask',
    bindings: { global: { uBatchWorldMatrix: 'mat4x4<f32>' } },
    gl: maskGl,
  };

  // after: instanceFetchBitGl declares uBatchWorldMatrix
  const maskBitGl: ShaderBit = { name: 'mask', gl: maskGl };
  const shaderDescriptor = {
    bitsGpu: [maskBit],
    bitsGl: [instanceFetchBitGl, maskBitGl],
    template: maskTemplate,
  };
  ```
  - A `BindingGroup` value can now be a nested `UniformGroupBindings` as well as a `BindingSpec`. Code that walks a bit's `bindings` has to handle both. A `BindingSpec` written as an object has a string `type`, and a nested group doesn't.
  ```ts
  import type { BindingSpec, UniformGroupBindings } from '@pixi/3d';

  function isNestedGroup(entry: BindingSpec | UniformGroupBindings): entry is UniformGroupBindings {
    return typeof entry === 'object' && typeof entry.type !== 'string';
  }
  ```
- feat: BatchedMesh3D instance data by @GoodBoyDigital
  - A custom `ShaderBitTemplate` (a `ShaderDescriptor`'s `template`) needs the new slot names where `material` comes into scope. In WGSL, `{{vertexMaterialAccess}}` is now `{{vertexStoreAccess}}` and `{{fragmentMaterialAccess}}` is now `{{fragmentStoreAccess}}`. In GLSL, `{{materialAccess}}` is now `{{storeAccess}}` in both the vertex and fragment source. An old slot name is filled with nothing, so any bit that reads `material.<field>` fails to compile until you rename it.
  ```wgsl
  // before: in the vertex entry point, then the fragment entry point
  {{vertexMaterialAccess}}
  {{fragmentMaterialAccess}}

  // after
  {{vertexStoreAccess}}
  {{fragmentStoreAccess}}
  ```
  ```glsl
  // before: in the vertex and fragment sources
  {{materialAccess}}

  // after
  {{storeAccess}}
  ```
  - `instance` is now a reserved `ShaderBit` `bindings` group. Fields under `bindings.instance` are read from a `BatchedMesh3D`'s `instanceData`, and compiling such a bit for any other mesh throws. Rename a custom bind group you called `instance`.
- feat: materials take as many texels of the store as their struct needs by @GoodBoyDigital
  - `vMaterialIndex`, `renderable.materialIndex` and the index `getMaterial()` takes now name the material's first texel in `uMaterialStorage`, not a 16-texel row. Shaders that read `material.<field>` or call `getMaterial(vMaterialIndex)` need no change. A shader that reads `uMaterialStorage` itself must drop the `* 16` from its base texel, in WGSL and in GLSL (`int(vMaterialIndex)`). Materials no longer sit 16 texels apart, and one with many fields can take more than 16.
  ```wgsl
  // before
  let base = i32(vMaterialIndex) * 16;

  // after
  let base = i32(vMaterialIndex);
  ```
- feat: scene outputs, extra textures the scene draw writes beside its colour by @GoodBoyDigital
  - In WGSL, the engine's material template now returns a `FragmentOutput` struct from `mainFragment`, which it fills from `finalColor` and `alpha` after the `end` slot. A WGSL bit on that template, such as an `extraBits` bit or a `descriptor` without its own `template`, that returned a colour from `end` or another fragment slot, as the old `ShaderBit` docs example did, now fails to compile. Set `finalColor` and `alpha` in `end` instead. GLSL bits need no change, since the template still declares `fragColor` and writes it after `end`.
  ```ts
  import type { ShaderBit } from '@pixi/3d';

  const halfBrightBit: ShaderBit = {
    name: 'halfBright',
    // before
    // gpu: { fragment: { end: 'return vec4<f32>(finalColor * 0.5, alpha);' } },
    // after
    gpu: { fragment: { end: 'finalColor *= 0.5;' } },
  };
  ```
  - The template's fragment stage also declares a local `outputs` and a struct `Outputs`, and in WGSL a struct `FragmentOutput`. A bit that declares one of those names now fails to compile, so rename it.
  - In a `PostEffect` or `FullscreenPass` fragment, `viewPos(uv)` now returns view space with Y up on every backend and target. On WebGPU, and on WebGL when the view draws into a texture such as under a 2D filter, its Y used to point down, and `uFxClip.w` (`fxh.uFxClip.w` in WGSL) flips sign in the same cases. Remove any Y negation you added to compensate.
  ```wgsl
  // before: undoing the old Y-down result on WebGPU
  let p = viewPos(uv) * vec3<f32>(1.0, -1.0, 1.0);
  // after
  let p = viewPos(uv);
  ```
  - On WebGL, a `FullscreenPass` that writes a texture imported with `graph.importColor`, such as a `RenderTexture` you show on a sprite, now lands upright when the view draws to the canvas. It used to land upside down, so remove any flip you added for it, such as a negative `scale.y` on the sprite.
- breaking: sample through a TextureBinding, and the graph binds into the renderer's global group by @GoodBoyDigital
  - `PassBuilder.sample(handle, binding)` takes a `TextureBinding` where it took a slot number, and `pipe.globalSlots` is gone. In a custom `RenderPass`, sample the opaque colour, opaque depth and shadow map through `b.globalTextureBindings`. To have the graph bind a texture into a bind group the pass owns, key the group by the binding names the pass's shader declares and pass a `TextureBinding` that names them. The graph binds the frame's texture before `render`.
  ```ts
  import { BindGroup, Texture } from 'pixi.js';
  import type { TextureBinding } from '@pixi/3d';

  // before
  b.sample(opaqueDepth, this.pipe.globalSlots.opaqueDepth);

  // after
  b.sample(opaqueDepth, b.globalTextureBindings.opaqueDepth);

  // a texture in a group the pass owns
  const group = new BindGroup({
    uTexture: Texture.WHITE.source,
    uTextureSampler: Texture.WHITE.source.style,
  });
  const input: TextureBinding = { group, slot: 'uTexture', styleSlot: 'uTextureSampler' };

  b.sample(source, input);
  ```
  - `globalTextureBindings` is now a required option of `DefaultGraph3DOptions` and `RenderGraphOptions`, and `createDefaultGraph3D` no longer defaults its `options`. A custom `View3DOptions.graph` builder must forward the `options` it receives. Spread them into `createDefaultGraph3D`, or pass `globalTextureBindings: options.globalTextureBindings` to a bare `RenderGraph`. TypeScript flags a builder that doesn't. In JavaScript the view's first render throws.
  ```ts
  import { createDefaultGraph3D, View3D } from '@pixi/3d';

  // before
  const view = new View3D({
    graph: (renderer) => createDefaultGraph3D(renderer, { composite: true }).graph,
  });

  // after
  const view = new View3D({
    graph: (renderer, options) => createDefaultGraph3D(renderer, { ...options, composite: true }).graph,
  });
  ```
  - `View3D.unload()` now destroys the view's render graph and the passes in it, and the next draw builds a new graph, calling a custom `graph` builder again. Passes in `View3DOptions.passes` carry over. pixi's GC also calls `unload` on a view that has been off the stage for `gcMaxUnusedTime`, so this can happen without your code calling it. Create graph passes inside the builder, and don't keep a reference to one across an unload.
- fix: an effect's depth read binds in its own group, not the view's global one by @GoodBoyDigital
  - `RenderGraph.compile()` now throws when a pass samples a transient that another pass renders into, such as `graph.sceneDepth`, through the view's global bind group, and the error names both passes. Beta.2 custom passes read the scene depth this way through `this.pipe.globalSlots.opaqueDepth`, as beta.2's `PostEffect.build()` did, and on WebGPU it failed validation every frame once blended meshes, particles or a hemisphere background drew. Sample it through a `TextureBinding` in a bind group your pass owns, not `b.globalTextureBindings`, or let a `FullscreenPass` read the depth, which now binds it in its own group.
  ```ts
  // before, in a custom RenderPass
  public override setup(b: PassBuilder): void {
    b.sample(this._sceneDepth, this.pipe.globalSlots.opaqueDepth);
  }

  // after, for a fullscreen read in a PostEffect's build()
  graph.addPass(
    new FullscreenPass({
      renderer: io.renderer,
      fragment: myFragment,
      reads: { color: io.input, depth: graph.sceneDepth },
      writes: io.output,
    }),
  );
  ```
- feat: View3D.resolution draws the scene at its own resolution by @GoodBoyDigital
  - `RenderGraphOptions.sceneColor` and `sceneDepth` no longer take `resolution`. The scene pair now follows `RenderGraph.resolution`, which the view sets every frame from the new `View3D.resolution`. If a custom graph drew its scene at its own resolution, remove `resolution` from the scene pair and set it on the view, through the `resolution` option or property. The units are the same, texels per logical pixel.
  ```ts
  import { RenderGraph, View3D } from '@pixi/3d';

  // before
  const view3d = new View3D({
    graph: () => {
      const graph = new RenderGraph({
        defaultColor: (s) => s.defaultTarget.colorTexture,
        defaultDepth: (s) => s.defaultTarget.depthStencilTexture!,
        sceneColor: { label: 'sceneColor', resolution: 1 },
        sceneDepth: { label: 'sceneDepth', resolution: 1 },
      });
      // add your passes
      return graph;
    },
  });

  // after
  const view3d = new View3D({
    resolution: 1,
    graph: (renderer, options) => {
      const graph = new RenderGraph({
        globalTextureBindings: options.globalTextureBindings,
        defaultColor: (s) => s.defaultTarget.colorTexture,
        defaultDepth: (s) => s.defaultTarget.depthStencilTexture!,
        sceneColor: { label: 'sceneColor' },
        sceneDepth: { label: 'sceneDepth' },
      });
      // add your passes
      return graph;
    },
  });
  ```
  - Every `PostEffect` and `FullscreenPass` fragment now comes with a `viewTexel()` helper, one physical pixel of the view as a UV step, and one that reads depth also gets `depthTexel()` and `fxDepthContent()`, in WGSL and GLSL. A custom fragment that defines a function with one of those names fails to compile, so rename yours or call the built-in one.

### 🎁 Added

- feat: load .hdr panoramas as HDR environment cubes by @GoodBoyDigital
  - `Assets.load('sky.hdr')` loads a Radiance `.hdr` panorama as an HDR `CubeTexture` for `View3D.environment` and `View3D.background`, so the sun and other light brighter than white stay bright. Faces default to a quarter of the panorama's width, rounded down to a power of two from 16 to 512, and `data.faceSize` overrides that.
  ```ts
  import { Assets } from 'pixi.js';
  import type { CubeTexture } from 'pixi.js';

  const sky = await Assets.load<CubeTexture>('sunset.hdr');
  view.environment = sky;
  view.background = sky;

  // larger faces for a sharper sky, at four times the memory per doubling
  const sharp = await Assets.load<CubeTexture>({ src: 'sunset_4k.hdr', data: { faceSize: 1024 } });
  ```
- feat: FxaaEffect smooths jagged edges in the post chain by @GoodBoyDigital
  - `FxaaEffect` smooths jagged edges in the finished image, a cheap stand-in for MSAA when the canvas has `antialias: false` or a scene output's format turns MSAA off for the view. Put it last in `view.passes`, and tune it with `edgeThreshold`, `edgeThresholdMin` and `edgeSharpness`.
  ```ts
  import { BloomEffect, FxaaEffect } from '@pixi/3d/extras';

  // FXAA goes last, since an effect after it can bring the jagged edges back
  view.passes = [new BloomEffect({ threshold: 0.5 }), new FxaaEffect()];

  // softer edges
  view.passes = [new FxaaEffect({ edgeSharpness: 4 })];
  ```
- feat: Model3D draws materials of its own, by label, index or function by @GoodBoyDigital
  - A `Model3D` can draw materials of its own instead of its source's shared ones. Pass `materials` as a record keyed by material `label` (the glTF loader sets it from the file's material names), an array by source index, or a function called once per distinct source material. Assigning `model.materials` switches the meshes the model built that are still under it, `undefined` goes back to the source's, and assignment never destroys the materials it replaces.
  ```ts
  import { Assets } from 'pixi.js';
  import { Material3D, Model3D } from '@pixi/3d';
  import type { Scene3DSource } from '@pixi/3d';

  const source = await Assets.load<Scene3DSource>('enemy.glb');
  const boss = new Model3D({ source, materials: { Paint: new Material3D({ baseColor: 0xff0000 }) } });

  // copies of its own, so a change doesn't reach other enemies
  const enemy = new Model3D({ source, materials: (material) => material.clone() });
  enemy.materials[0].baseColor = 0x00ff00;

  // back to the shared materials, then destroy the copies
  const copies = enemy.materials;
  enemy.materials = undefined;
  for (const material of copies) material.destroy();
  ```
- feat: dissolveBit dissolves any material, with a glowing edge by @GoodBoyDigital
  - `dissolveBit` from `@pixi/3d/extras` cuts any material away with noise as `material.data.dissolve` goes from 0 to 1, with an optional glowing edge from `dissolveEdgeColor` and a hole size, in the mesh's stored units, from `dissolveHoleSize`. With `Model3D.materials` and `material.clone` it takes one line on a loaded model. Shadows and outlines don't dissolve.
  ```ts
  import { dissolveBit } from '@pixi/3d/extras';

  enemy.materials = (material) => material.clone({ extraBits: [dissolveBit] });

  let progress = 0;
  app.ticker.add((ticker) => {
    progress = Math.min(1, progress + ticker.deltaMS / 1500);
    for (const material of enemy.materials) {
      material.data.dissolve = progress;
      material.data.dissolveEdgeColor = [6, 2, 0.4];
    }
  });
  ```
- feat: Material3D takes textures, and materials take vertexColors by @GoodBoyDigital
  - `Material3D` now takes a `textures` option, so you can fill an `extraBits` bit's texture slots when you build the material. `Material3D`, `PhongMaterial`, `FlatMaterial`, `ToonMaterial` and `PortalMaterial` also take `vertexColors`, which tints the material by the geometry's vertex colours.
  ```ts
  import { Material3D } from '@pixi/3d';

  // splatBit is your ShaderBit with textures: ['splat']
  const material = new Material3D({
    extraBits: [splatBit],
    textures: { splat: splatMap },
    vertexColors: true,
  });
  ```
- feat: a mesh joins or leaves a render pass on its own with enablePass and disablePass by @GoodBoyDigital
  - `Mesh3D.enablePass(name)` and `disablePass(name)` put one mesh in or out of a render pass whatever its material says, so hovering one of many meshes that share a material can outline just that one. `disablePass('opaque')` hides a mesh's body while it still casts its shadow. Setting `castShadow` now does the same as `enablePass('shadow')` or `disablePass('shadow')`.
  ```ts
  import { View3D } from '@pixi/3d';
  import { OutlinePass } from '@pixi/3d/extras';

  const view3d = new View3D({ passes: [new OutlinePass({ width: 0.05, color: 0xff3399 })] });

  enemy.eventMode = 'static';
  enemy.on('pointerenter', () => enemy.enablePass('outline'));
  enemy.on('pointerleave', () => enemy.disablePass('outline'));

  // Casts a shadow with no visible body
  ghost.disablePass('opaque');
  ```
- feat: hide and show BatchedMesh3D slots without rebuilding by @GoodBoyDigital
  - `BatchedMesh3D.setVisibleAt(index, visible)` hides and shows a slot in place, and `getVisibleAt(index)` reads it back. A hidden slot keeps its geometry, material, matrix and passes and draws nothing, shadows included, and a flip rebuilds no draw lists. To spawn and despawn, size the batch for the most slots you'll need and hide the spares, instead of taking them out with `setPassesAt`.
  ```ts
  import { BatchedMesh3D, Matrix4 } from '@pixi/3d';

  const bullets = new BatchedMesh3D({ size: 500 });
  // setGeometryAt, setMaterialAt and setPassesAt for every slot, then hide them all
  for (let i = 0; i < bullets.size; i++) bullets.setVisibleAt(i, false);

  function spawn(matrix: Matrix4): void {
    for (let i = 0; i < bullets.size; i++) {
      if (bullets.getVisibleAt(i)) continue;
      bullets.setMatrixAt(i, matrix);
      bullets.setVisibleAt(i, true);
      return;
    }
  }
  ```
- fix: spawn() takes sizeEnd, alphaEnd, spin and colorEnd per burst by @GoodBoyDigital
  - `ParticleSystem3D.spawn()` now takes `sizeEnd`, `alphaEnd`, `spin` and `colorEnd` per burst, under their option names. Each one needs the system built with the matching option, or `spawn()` throws, and a `colorEnd` override lasts for its burst only.
  ```ts
  import { ParticleSystem3D } from '@pixi/3d/extras';

  const puffs = new ParticleSystem3D({ size: 0.2, sizeEnd: 1, alphaEnd: 0, spin: 1, colorEnd: 0x333333 });

  // The overrides apply to this burst only
  puffs.spawn(20, { sizeEnd: [2, 3], alphaEnd: 0.2, spin: [-6, 6], colorEnd: 'orange' });
  ```
- feat: distance fade, depth-aware blur, and a cheaper blur by @GoodBoyDigital
  - `SsaoEffect` takes `fadeDistance: [start, end]`, in world units of view depth, as an option or a property. It fades occlusion out across that band and skips the samples past `end`, which stops speckle and dark bands on distant ground.
  ```ts
  import { SsaoEffect } from '@pixi/3d/extras';

  const ssao = new SsaoEffect({ fadeDistance: [40, 80] });
  view.passes = [ssao];

  // occlusion at every depth again
  ssao.fadeDistance = null;
  ```
- feat: Container3D.traverse runs a callback on a whole subtree by @Zyie
  - `Container3D.traverse(callback)` calls `callback` with the container it's called on, then with every container under it, depth first, hidden ones included. The callback can remove, destroy or replace the container it's given, and the walk can't stop early.
  ```ts
  import { Light } from '@pixi/3d';

  model.traverse((container) => {
    if (container instanceof Light) container.removeFromParent();
  });
  ```
- feat: View3D.raycast takes an out hit, and picking skips far meshes by @Zyie
  - `View3D.raycast(position, out?)` fills and returns a hit you pass in, so picking every frame with one hit from `createRaycastHit3D()` allocates nothing. A miss returns `null` and leaves `out` as it was.
  ```ts
  import { createRaycastHit3D } from '@pixi/3d';

  const hover = createRaycastHit3D();

  app.ticker.add(() => {
    const hit = view3d.raycast(app.renderer.events.pointer.global, hover);
    if (hit) cursor3d.position.copyFrom(hit.point);
  });
  ```
- feat: Camera3D.jitter moves the drawn image by a sub-pixel offset by @GoodBoyDigital
  - `Camera3D.jitter` is a `Point` that shifts the drawn image by a sub-pixel offset in the scene's pixels, `+x` right and `+y` down, for temporal anti-aliasing and upscalers that blend frames. Only the drawn image moves; `projection`, culling and picking never see it, and a changing offset with nothing blending the frames makes the image shake.
  ```ts
  const halton = (index: number, base: number): number => {
    let result = 0;
    for (let f = 1 / base, i = index; i > 0; i = Math.floor(i / base), f /= base) {
      result += f * (i % base);
    }
    return result;
  };

  // Only with a pass that blends frames
  let frame = 0;
  app.ticker.add(() => {
    frame = (frame % 8) + 1;
    view3d.camera.jitter.set(halton(frame, 2) - 0.5, halton(frame, 3) - 0.5);
  });
  ```
- feat: getAttributeData reads a vertex attribute as floats, however it is stored by @Zyie
  - `getAttributeData(geometry, attributeId, size, out?)` reads a vertex attribute as floats, `size` per vertex, however it's stored: quantized normals and tangents, KHR_mesh_quantization glTF data and interleaved geometries. `Geometry3D.normals` returns data as stored (by default an `Int16Array` with four values per vertex), so use this for CPU maths on a mesh instead of casting or dividing by `32767`.
  ```ts
  import { getAttributeData, Vector3 } from '@pixi/3d';

  const normals = getAttributeData(geometry, 'aNormal', 3);
  const normal = new Vector3().fromArray(normals, vertexIndex * 3);

  // Fill slices of one merged buffer
  const merged = new Float32Array((first.vertexCount + second.vertexCount) * 3);
  getAttributeData(first, 'aPosition', 3, merged);
  getAttributeData(second, 'aPosition', 3, merged.subarray(first.vertexCount * 3));
  ```
- feat: glTF and GLB models load KTX2, AVIF and WebP textures by @Zyie
- feat: scene outputs keep the canvas's MSAA by @Zyie
- feat: RenderGraph.getTexture gives a pass the live texture behind a handle by @GoodBoyDigital
- feat: a light's color takes any ColorSource by @GoodBoyDigital

### ⚡ Performance

- fix: cheaper keyframe search, Vector3 lerp and quaternion slerp by @Zyie
- fix: the render graph, pipes and cascades allocate less per frame by @Zyie
- fix: WebGPU passes sharing a draw list build it once a frame by @Zyie
- fix: batched-slot pass caches no longer start in dictionary mode by @Zyie
- feat: batch texture bind groups stop swapping listeners on every rebuild by @GoodBoyDigital
- feat: sorted views re-sort from the order they produced last time by @GoodBoyDigital
- feat: stores upload only the slots that changed by @GoodBoyDigital
- feat: unculled batches compact hidden slots on the GPU by @GoodBoyDigital
- perf: fetch glTF images alongside buffers by @GoodBoyDigital
- feat: batcher walk skips work it already did this build by @GoodBoyDigital
- feat: the CPU cull reads packed bounding spheres and visibility bytes from the mesh store by @GoodBoyDigital
- perf: on WebKit, batches within a cap cull on the CPU and draw direct by @GoodBoyDigital
- perf: an 'off' batch drawn direct records its direct draws into a bundle by @GoodBoyDigital
- perf: merged WebGL runs, once-per-build capture, sorted-pass replay and texture watching (#641–#655) by @Zyie
- perf: a WebGL list uploads only the index texels its compaction changed by @GoodBoyDigital
- perf: the texture set is a counted id on the material by @GoodBoyDigital
- perf: GeometryAtlas.add copies attributes 4 bytes at a time by @Zyie
- perf: draw commands own their members by @GoodBoyDigital
- perf: bloom's blur levels take rg11b10ufloat, and the output pass dithers by @GoodBoyDigital

### 🐛 Fixed

- fix: the bone pit skips its upload when no skeleton changed by @Zyie
- fix: OrbitCamera 'change' listeners calling update() no longer recurse by @Zyie
- fix: environment lighting bakes less and frees what it bakes by @Zyie
- fix: release pooled textures before the texture pool evicts them by @GoodBoyDigital
- breaking: a View3D renders with one renderer by @GoodBoyDigital
- breaking: bind groups are keyed by binding name by @GoodBoyDigital
- fix: an atlased geometry with no indices draws nothing, never the whole atlas by @GoodBoyDigital
- fix: graph overlay stops reading every WebGPU shadow frame as pending by @Zyie
- fix: a material-bit pass with its own shader binds no material by @GoodBoyDigital
- fix: BatchedMesh3D spare slots can stay empty until they join a pass by @Zyie
- fix: a casting light over an empty shadow pass leaves receivers unshadowed by @Zyie
- fix: name BatchedMesh3D batches by their label by @GoodBoyDigital
- fix: esbuild and Turbopack load only the backend a renderer picks by @Zyie

### 🧹 Chores

- refactor: namespace glTF types under GltfFormat by @Zyie
- chore: split agent docs, lint the coding standards, add setup by @Zyie
- chore: tests and comment fixes from reviewing the #559 stack by @Zyie
- fix: link the asset mirror with a junction on Windows by @Zyie
- chore: split compileMaterialShader out of ensureMaterial by @GoodBoyDigital
- chore: run CI on Namespace runners by @Zyie
- chore: rebuild the examples as a teaching gallery on a shared theme kit by @Zyie
- chore: prune unit tests that restate the code or duplicate scenes by @Zyie
- chore: restructure the agent docs and cut AGENTS.md to a router by @Zyie
- chore: add the guides, review the JSDoc and check docs in CI by @Zyie
- feat: ship the pixi3d agent skill in the npm package by @Zyie
- chore: rebuild the un-themed examples on the theme kit by @Zyie
