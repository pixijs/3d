### 🚨 Behavior Change

- feat: light tile mask on WebGPU, and one upload per camera by @GoodBoyDigital
  - `prepareCamera` no longer uploads a camera. `uploadCamera` does that after the view's lights are packed, and `RenderGraph.prepareCameras` runs both for every camera the graph draws. If you drive the graph yourself, call `prepareCameras`; a camera that never reaches `uploadCamera` keeps all-set tile masks and walks every light slot, which is correct but slower.
  - Known limit on WebGPU: a camera's viewport rect is written once per frame. A custom pass that draws lit geometry into a smaller transient of its own reads the wrong tile, and lights can drop out of it. WebGL copies the live viewport per draw and is unaffected.
- perf: WebGPU reads lights and shadow data from the global uniforms, like WebGL by @GoodBoyDigital
  - The WGSL storage buffers `uLightStorage` and `uShadowStorage` are gone. Both backends now read the same two uniform arrays, `uLightData` and `uShadowData`, from the global group. A custom WGSL shader bit that read either storage buffer must switch to the global arrays. WGSL bindings are numbered in declaration order, so the global-group bindings after the removed pair shifted down by two.
- feat: screen-tile light mask for the WebGL forward light loop by @GoodBoyDigital
  - A custom material built with `createLightingBit` now needs the camera bindings, because the light loop reads the tile mask and the viewport from the camera group. `includeCamera` is on by default; leave it on. The same applies on WebGPU.

### 🎁 Added

- feat: View3D.from and autoResize by @Zyie
  - `View3D.from(source, options)` turns a loaded glTF into a working scene in one call. The `Model3D` becomes the View's `root`, the file's own camera is used when it has one, otherwise a default `Camera3D` is placed to frame the model's bounds, and a file with no lights gets a key light parented under the camera. Pass `light: false` to skip that light. `View3D` is generic over its root, so `from` returns `View3D<Model3D>` and `view.root` is typed as the model. Options are every `View3DOptions` field plus the per-instance `Model3D` ones (`scene`, `castShadow`, `receiveShadow`, `autoPlay`, `autoUpdate`). glTF camera nodes now instantiate as `Camera3D` and are listed on `model.cameras`; they were plain containers before.
  ```ts
  import { Assets } from 'pixi.js';
  import { View3D } from '@pixi/3d';

  const view = View3D.from(await Assets.load('robot.glb'), { autoResize: true });

  app.stage.addChild(view);
  view.root.player?.play('Wave');
  ```
  - The new `autoResize` option, off by default, makes a View fill the renderer's screen and follow it. The size is applied in pixi's per-frame `onRender` hook, before the frame's bounds and instructions are built, so filters and hit-testing see the new rect in the same frame. Setting a size later turns `autoResize` off, so an explicit size always wins. This is what the examples used to hand-roll:
  ```ts
  // before
  const view3d = new View3D({
    width: app.screen.width,
    height: app.screen.height,
    shadowQuality: 'high',
  });

  app.ticker.add(() => {
    view3d.setSize(app.screen.width, app.screen.height);
  });

  // after
  const view3d = new View3D({ autoResize: true, shadowQuality: 'high' });
  ```
- feat: write BatchedMesh3D matrices in place by @GoodBoyDigital
  - `BatchedMesh3D.matrices` exposes the batch's interleaved instance data, so a per-frame transform update can be computed straight into it instead of building a `Matrix4` and copying it through `setMatrixAt`. Call `matrices.update()` once after writing to notify the batch. About 2.3 ms saved per frame at 500,000 instances on an M-series Mac.
  ```ts
  const { data, stride, offset } = batched.matrices;

  for (let i = 0, o = offset; i < batched.size; i++, o += stride) {
    data[o + 13] = heights[i]; // translation Y
  }

  batched.matrices.update();
  ```

### ⚡ Performance

- feat: screen-tile light mask for the WebGL forward light loop by @GoodBoyDigital
  - Lit WebGL materials reject lights that cannot reach the fragment before loading them. A 353-mesh, 32-light scene at 1080p went from 2.15–2.30 ms to 1.31–1.37 ms of GPU time on an M3 Max.
- feat: light tile mask on WebGPU, and one upload per camera by @GoodBoyDigital
  - WebGPU gets the same rejection, so many-light scenes cost the same on both backends. Directional and unbounded lights are always kept, so nothing goes dark.
- feat: cull lights by camera depth and skip empty WebGL mask bits by @GoodBoyDigital
  - Lights are also culled by depth, and the WebGL light loop jumps straight to the next live light instead of stepping through empty slots. On a Snapdragon X Elite, a 32-light scene dropped from 4.18 ms to 2.58 ms of GPU time on WebGL, and 2.84 ms to 2.57 ms on WebGPU.
- perf: no environment lighting work for a view with no environment by @GoodBoyDigital
  - A View with no environment no longer pays for image-based lighting in its PBR shaders, and no longer builds the BRDF lookup texture. That saves 4.4 ms of first-frame work and 2 MB of GPU memory on a view that never had an environment.
- perf: draw alpha-masked meshes after the opaque ones in a pass by @GoodBoyDigital
  - Meshes with `alphaMode: 'mask'` draw after the opaque ones, so the depth test throws away hidden cutout fragments before they are shaded. Foliage and other cutout-heavy scenes get cheaper. The picture is identical.
- perf: WebGPU reads lights and shadow data from the global uniforms, like WebGL by @GoodBoyDigital
  - Light and shadow data are read the same way on both backends, with no per-frame copy. Up to 12% faster on a WebGPU scene with 32 unbounded point lights.
- perf: lit shaders leave shadow sampling out until a light first casts by @GoodBoyDigital
  - A View with no shadow-casting light no longer compiles shadow sampling into its lit shaders, which is worth 3–7% of frame time on both backends. The sampler is compiled in the first time a visible light casts, so there is at most one recompile in a View's life.

### 🐛 Fixed

- fix: loader parsers carry the name pixi's validator hashes on by @Zyie
  - pixi logged `[Assets] parser id conflict` on startup. The three load parsers had no `name`, so pixi's validator hashed them all onto the same key. Each parser now carries its own name.
- fix: the WebGL group map stops warning about struct-only bind groups by @Zyie
  - Every material shader compile on WebGL logged a warning about the `material` group having no bind-group slots. It is packed into the material struct by design, so it is now skipped in silence, the way the WGSL side already did.
- fix: glTF custom-attribute notices go through pixi's warn, once per semantic by @Zyie
  - Loading a glTF with a custom vertex attribute logged a `[gb-model-tools]` warning for every primitive in the file. It is now one `[pixi-3d]` warning per semantic, through pixi's `warn`.
- fix: the back-buffer notice for glass warns once per renderer by @Zyie
  - A transmissive material with `useBackBuffer` off raised its notice every frame, hitting pixi's 500-warning cap within seconds. It now warns once per renderer, and the per-frame check stops after that.
- fix: WebGL shader precision comes from one compiler plugin, plus IBL hardening by @GoodBoyDigital
  - On mobile GPUs, where GLSL ES 3.00's default precision actually applies, `mediump` ints lost the top half of a 32-bit bit-twiddle and `lowp` samplers clamped data textures to [-2, 2]. Built-in templates had drifted and several fragment stages were missing `precision highp int` entirely. One compiler plugin now writes the `highp` declarations into both stages of every compiled shader, including user-written templates. Two IBL fixes came along: the Fresnel term matches the other lighting bits, and the prefilter divide can no longer bake a NaN into a mip.
- fix: WebGPU shadow lookup takes two floats, not the light struct by @GoodBoyDigital
  - On Adreno 8xx phones under WebGPU, every surface a light reached rendered solid black. Passing the whole `Light` struct into the shadow function returned wrong field values on that driver, so a light with no shadow fell into an empty shadow slot and produced NaN. The function now takes the two values it needs.
- fix: fast-path default WebGPU texture values by @GoodBoyDigital
  - The WebGPU batch texture sampler answers the reserved black, white and flat-normal slots without branching around a texture fetch. Output is unchanged on every slot.
- fix: WebGPU batch texture sampling stalls on Apple GPUs with MSAA by @GoodBoyDigital
  - Apple GPUs stall for several milliseconds when a texture sample sits inside a branch in a fragment shader compiled for 4x MSAA. The renderer now picks a branch-free sampler from the adapter info when MSAA is on, and keeps the cheaper branching one everywhere else.
- fix: shadow pass no longer runs for lights that cannot cast by @GoodBoyDigital
  - A View whose only lights asking to cast shadows were point or ambient lights still ran the whole shadow pass, which produced nothing. `Light.canCastShadow` is now the single rule for whether a light casts, and `PointLight` and `AmbientLight` return `false`.

### 🧹 Chores

- chore: drop the View3D resize boilerplate from the examples by @Zyie
  - Every full-screen View in the examples and playground now passes `autoResize: true` instead of sizing itself from `app.screen` and re-applying it on a ticker. Inset, letterboxed and fixed-size Views keep their explicit sizes. 18 tickers that did nothing else are gone.
