### 🚨 Behavior Change

- chore: bump pixi.js peer dependency to 8.22.0 by @Zyie
  - `@pixi/3d` now needs pixi.js 8.22.0 or later, so upgrade pixi.js before you install this build. This release uses three things 8.22.0 added: the `contextmenu` event, partial texture uploads, and integer textures on WebGL. On 8.21, every WebGL render breaks.
  ```sh
  npm install pixi.js@^8.22.0
  ```
- breaking: read material rows from the data texture on WebGPU by @GoodBoyDigital
  - This affects custom shader bits that declare `material` fields.
  - A material field must be `f32`, `u32`, `i32`, a `vec2`, `vec3` or `vec4` of `f32`, or `mat2x2<f32>`. Creating a material with any other type throws, and the error names the bit and the field. A material struct larger than its 256-byte row also throws, where it used to spill into the next material's data.
  - In WGSL, `uMaterialStorage` is a texture now, so `uMaterialStorage[i]` no longer compiles. Read the `material` local, which both stages have, or call `getMaterial(index)` for another material's row.
  ```wgsl
  // before
  let tint = uMaterialStorage[vMaterialIndex].tint;
  // after
  let tint = material.tint;
  ```
  - In GLSL, the compiler emits `getMaterial()` after `gl.header`, so code in the header can't call it. Code in the stage slots still can.
- fix: WebGL reads integer data through integer textures by @GoodBoyDigital
  - This affects custom shader bits and passes that read the engine's data stores directly.
  - In the WebGPU global group, the material rows move to binding 9 as a `texture_2d<u32>`. The five storage buffers that sat at bindings 9 to 13 each move up one, to 10 to 14. Renumber anything that binds by slot number.
  - In WebGL bits, `fetchStoreTexel()` returns a `uvec4`. Wrap float lanes in `uintBitsToFloat(...)` and read integer lanes directly. `renderInstance.y` holds the whole packed texture-slot word.
- fix: WebGPU batch samplers take the implicit level of detail by @GoodBoyDigital
  - The shader helpers `sampleBatchTexture` and `_unpackSlot` are gone from the WGSL and GLSL headers, so a custom `ShaderBit` that calls them fails to compile. Call the generated `sample<Name>(uv)` and `sample<Name>Direct(uv)` getters instead, or `sampleBatchSlotGrad(slot, uv, dx, dy)` with the slot read from `_textureSlots` in WGSL or `vTextureSlots` in GLSL.
  - Every WGSL module now starts with `diagnostic(off, derivative_uniformity);`, so WebGPU no longer checks a bit's derivatives for uniform control flow. Keep your own `textureSample`, `dpdx` and `dpdy` calls in uniform control flow. `textureSampleLevel` and `textureSampleGrad` can sit in any branch.
- feat: BatchedMesh3D cull option by @GoodBoyDigital
  - A `BatchedMesh3D` no longer takes its culling mode from the view. Each batch has its own `cull`, and it defaults to `'off'`, so every instance draws. In beta.1 a batch followed the view's `cull`, which defaults to `'auto'`. Turn culling back on for a large batch spread well beyond the view, such as scattered scenery:
  ```ts
  const forest = new BatchedMesh3D({ size: treePositions.length, cull: 'auto' });
  ```
  - A view's `cull` option now covers its `Mesh3D`s only. `new View3D({ cull: 'off' })` no longer turns culling off for the view's batches.
- feat: OrbitCamera and FPSCamera keep the context menu from opening by @Zyie
  - Once a View has an `OrbitCamera` or `FPSCamera`, the browser's context menu stops opening over that View. Pass `preventContextMenu: false` to get it back. The menu also opens while the controller's `enabled` is `false`.
  ```ts
  import { OrbitCamera } from '@pixi/3d/extras';

  new OrbitCamera({ view: view3d, preventContextMenu: false });

  // or for every controller created after this line
  OrbitCamera.defaultOptions.preventContextMenu = false;
  ```
- feat: View3D.background accepts a Hemisphere by @Zyie
  - `View3D#background` is now typed `CubeTexture | Hemisphere | null`. TypeScript code that reads it as a cube map has to narrow it first:
  ```ts
  import { CubeTexture } from 'pixi.js';

  if (view3d.background instanceof CubeTexture) {
    const cubeSource = view3d.background.source;
  }
  ```
- fix: use the glTF default material for primitives without one by @Zyie
  - A glTF primitive that names no material now renders with the glTF default material: white, metallic 1, roughness 1, opaque and single-sided. It used to take the file's first material. A material with no `pbrMetallicRoughness` block now gets the spec's metallic 1 and roughness 1. Models that hit either case look different. The loader appends the default material to `source.materials`, after the file's own, and every primitive that needs it shares that one instance.

### 🎁 Added

- feat: View3D.background accepts a Hemisphere by @Zyie
  - `View3D`'s `background` takes a `Hemisphere` and draws its sky and ground gradient behind the scene, on WebGL and WebGPU. The gradient uses the same formula as a hemisphere `environment`, so one object passed to both gives a sky that matches the scene's light. The view's exposure and tone mapping apply, as they do to a cube map. A colour change shows on the next frame. The option also accepts `null`.
  ```ts
  import { type Hemisphere, View3D } from '@pixi/3d';

  const sky: Hemisphere = { skyColor: 0x88ccff, groundColor: 0x553311 };
  const view3d = new View3D({ autoResize: true, environment: sky, background: sky });

  sky.skyColor = 0xff8800; // sunset
  ```
- feat: BatchedMesh3D cull option by @GoodBoyDigital
  - `BatchedMesh3D` takes a `cull` option, also a property, with the `CullMode` values `'off'`, `'auto'`, `'cpu'` and `'gpu'`. A change applies from the next render, in the main and shadow passes. Off is the default because a batch's instances usually move every frame and stay mostly in view, where testing each one costs more than drawing the few off screen. In a game with about 2,200 moving boxes in one batch, turning culling off cut 3 to 3.5 ms of render CPU per frame on an iPhone 15.
  ```ts
  const crowd = new BatchedMesh3D({ size: 8192 });
  const forest = new BatchedMesh3D({ size: 10_000, cull: 'auto' });

  forest.cull = 'cpu';
  ```
- feat: OrbitCamera and FPSCamera keep the context menu from opening by @Zyie
  - `OrbitCamera` and `FPSCamera` take a `preventContextMenu` option, also a property you can change at runtime. It defaults to `true`, so a right-button pan or a drag to look around no longer opens the browser menu. Windows opens the menu on release, so there a right-button drag that ends outside the View still opens it.
  - 3D nodes receive `contextmenu` events like the other pointer events, with `hit3D` set, and gain an `oncontextmenu` handler property. `preventDefault()` keeps the browser menu closed. `stopPropagation()` lets it open and hides the event from the View's own listeners, such as a camera controller's.
  ```ts
  mesh.on('contextmenu', (e) => {
    e.preventDefault();
    openMenuFor(mesh, e.global);
  });
  ```
- breaking: read material rows from the data texture on WebGPU by @GoodBoyDigital
  - Custom shader bits can declare `mat2x2<f32>` material fields, on both backends.
- fix: WebGL reads integer data through integer textures by @GoodBoyDigital
  - Shader bit bindings can declare integer textures as `texture_2d<u32>` and `texture_2d<i32>`. WebGL declares them as `usampler2D` and `isampler2D`.

### ⚡ Performance

- feat: upload only the changed texels of data textures by @GoodBoyDigital
  - Data textures upload only the texels that changed, not the whole texture. Moving one mesh in a 10,000-mesh batch used to upload 960 KB or more, and now uploads 96 bytes. This covers every data texture on WebGL and the material data on WebGPU.
- fix: cut per-frame garbage and wasted work on hot paths by @GoodBoyDigital
  - Setting a position, rotation or scale no longer allocates, and neither do material checks on a changed mesh, particle writes or `seededRandom` draws. A 5,000-mesh animated scene went from 246 KB to 6.8 KB of garbage per frame in Chrome. `seededRandom` returns the same numbers as before for each generator's first 4,917,757 draws.
- fix: bound light-mask loops for mobile GPUs by @GoodBoyDigital
  - Lit shaders walk the light mask in loops with a fixed number of iterations, which some mobile shader compilers run much faster. Sponza with 32 point lights on an iPhone 15 under WebGPU went from 46.7 ms to 30.5 ms per frame. A Pixel 9 under WebGPU pays about 0.5 ms for the same change.
- fix: WebGPU batch samplers take the implicit level of detail by @GoodBoyDigital
  - WebGPU texture sampling lets the GPU pick the mip level. Sponza at 1080p with 4x MSAA went from 0.88 ms to 0.72 ms of GPU time on an M3 Max in Chrome. The picture is identical.
- breaking: read material rows from the data texture on WebGPU by @GoodBoyDigital
  - WebGPU fragment shaders no longer read a storage buffer. On Apple GPUs with MSAA, that one read made the rest of the fragment shader several times slower.

### 🐛 Fixed

- fix: WebGL reads integer data through integer textures by @GoodBoyDigital
  - On WebGL, a scene with several materials could draw every mesh with the first material, morph targets never applied, and skinned meshes read the wrong bones. Some GPUs flush tiny float values to zero, which wiped out the integers the engine kept in float textures. A tester hit this on Chrome for macOS. Those textures are integer textures now. Fixes #2.
- chore: bump pixi.js peer dependency to 8.22.0 by @Zyie
  - The WebGL shadow pass no longer warns that `aNormal` and `aUV` are present in the geometry but not in the shader. pixi.js 8.22.0 carries the fix. Fixes #4.
- fix: shadow auto-fit reads live caster membership, not a stale sort by @Zyie
  - A mesh with `castShadow: false` could land in a directional light's auto-fit shadow box on the first frame and trigger a false "Shadow auto-fit box spans a large scene" warning. A caster you add or remove now shows up in the box that frame instead of the next. Over the auto-fit caster cap, the box now freezes and warns on the first frame instead of the second. Fixes #3.
- fix: apply View3D visibility and transform changes by @Zyie
  - A `View3D` added to the stage hidden stayed hidden after `visible` or `renderable` went back to `true`. Setting `alpha` to 0, moving or scaling the View after its first render, and `rotation` and `skew` had no effect either. All of these apply now, and `worldToScreen`, `screenToRay`, `toGlobal` and the View's bounds follow.
- fix: keep the WebGL bone texture aligned to whole rows when the bone pit grows by @Zyie
  - On WebGL, skinned meshes froze, or vanished on their first frame, once one `View3D` held more than 1,024 bones.
- fix: drop the GGX guard that flattened smooth highlights by @Zyie
  - A smooth clearcoat highlight peaked at about 1/800 of its correct brightness, and lowering roughness dimmed it instead of sharpening it. Smooth metal highlights were capped the same way. Both now reach their full peak, so glossy materials look brighter and sharper where light reflects.
- fix: copy atlas fast-path vertices as bytes and check the layout first by @GoodBoyDigital
  - Positions-only geometry, and `interleave: true` geometry whose attribute order differs from the geometry atlas's, drew with corrupted vertices. A static positions-only line list no longer needs `dynamic: true` to draw correctly. Part of #1.
- fix: copies read the target their camera drew, not whatever is bound by @GoodBoyDigital
  - Glass in a View could refract another camera's picture when a `MeshPass` drew that camera into a render texture at the `'afterOpaque'` stage. `CopyOpaquePass` and `CopyDepthPass` now always copy their own camera's target, so a custom pass list can place them anywhere after the draws they copy and before the passes that read the copy.
- breaking: read material rows from the data texture on WebGPU by @GoodBoyDigital
  - On WebGPU, a second `View3D` that added enough materials mid-frame to grow the material store lost the whole frame.
- fix: a read-only-depth pass resolves to pixi's default target instead of reconfiguring the canvas by @Zyie
  - On WebGPU, a material drawn in the blended-refraction pass, such as the water in the walrus-cave example, dropped a frame and logged `Destroyed texture ... used in a submit`.
- fix: shadow passes let go of pipe stores when their renderer is destroyed by @Zyie
  - Destroying a renderer while a `View3D` was still alive logged `[BindGroup] ... destroyed while still bound` twice per View.
- fix: IBL prefilter and BRDF LUT release their one-shot bind groups by @Zyie
  - Setting up image-based lighting left a bind group, a shader and a render target alive after their one draw. Destroying the environment texture later logged `[BindGroup] ... destroyed while still bound`.

### 🧹 Chores

- chore: fact-check the API docs across src by @Zyie
  - Every doc comment in `src` now matches the code it describes, and every `ts` example in the API docs type-checks against the current source.
- chore: fix the glTF viewer, comparison and walrus-cave examples by @Zyie
  - The glTF viewer opens on a sample model, the comparison examples load their models from the shared asset manifest, and the walrus-cave sky draws unlit.
