Before and after pairs, one move each; a SHA marks a pair taken from an audit commit. A `...` line marks code left out of the excerpt.

## A comment that restates the code, deleted
`6c68dc8f src/assets/loaders/gltf/process/processMaterials.ts`

Before
```ts
  // --- KHR_materials_ior ---
  const iorExt = rawMaterial.extensions?.KHR_materials_ior;
  if (iorExt) {
    options.ior = iorExt.ior ?? 1.5;
  }
```
After
```ts
  const iorExt = rawMaterial.extensions?.KHR_materials_ior;
  if (iorExt) {
    options.ior = iorExt.ior ?? 1.5;
  }
```
The banner repeats the extension name the next line already reads, so it tells the reader nothing.

## A magic value becomes a named constant
`6c68dc8f src/assets/loaders/gltf/utils/glbToGltf.ts`

Before
```ts
  // Chunks
  let offset = 12;
```
After
```ts
const GLB_HEADER_BYTES = 12;
...
  let offset = GLB_HEADER_BYTES;
```
The name says the chunks start right after the header, so the `// Chunks` label has nothing left to do. The constant isn't exported and holds no guard, so it carries no JSDoc; the GLB spec says what the 12 bytes are.

## An inline note moves to the JSDoc of the declaration that owns it
`9b181d33 src/animation/AnimationPlayer.ts`

Before
```ts
  /**
   * Advances all playing states and applies the blended results to their targets
   * ...
   */
  public update(ticker?: Ticker): void {
    ...
    // States played from a callback join next frame.
    const count = states.length;
    ...
    // Callbacks run once every pose is applied, so they see the final frame and can
    // freely play, stop, or seek other states.
    for (let i = 0; i < count; i++) {
      states[i]._emitCallbacks();
```
After
```ts
  /**
   * Advances all playing states and applies the blended results to their targets
   * ...
   * `onComplete` and `onLoop` callbacks run once every pose is applied, so they see this frame's
   * final pose and may play, stop or seek any state. A state they start begins advancing on the
   * next update.
   * ...
   */
  public update(ticker?: Ticker): void {
    ...
    const count = states.length;
    ...
    for (let i = 0; i < count; i++) {
      states[i]._emitCallbacks();
```
Both notes describe what a caller of `update` sees, so they belong in its JSDoc, where a user meets them, not in a body only maintainers open.

## A false claim, corrected against the code
`a584163b src/geometry/SphereGeometry.ts`

Before
```ts
/**
 * A UV sphere geometry built as a longitude-by-latitude grid around the +Y axis
 *
 * UVs run from `(0, 0)` at the south pole seam to `(1, 1)` at the north pole seam,
 * equirectangular-style.
 * ...
```
After
```ts
/**
 * A UV sphere geometry built as a longitude-by-latitude grid around the +Y axis
 *
 * UVs are equirectangular: `u` wraps once around the Y axis, starting at +X, and `v` runs from 0 at
 * the north pole (+Y) to 1 at the south pole, so an image's top row lands on the north pole.
 * ...
```
The constructor's first row has `phi = 0`, which puts it at +Y with `v = y / heightSegments = 0`, so the old doc had the poles swapped; when a doc and the code disagree, the code wins.

## A public doc that listed internals, rewritten for a user
`51d74265 src/post-processing/effects/FullscreenPass.ts`

Before
```ts
/**
 * One fullscreen-triangle draw of an `effect(uv)` fragment
 *
 * The reusable primitive behind every effect pass, and equally usable from a custom graph.
 * It owns the bit-compiled shader (standard header: content-space UV, orientation, the per-input
 * clamp rects that map and guard the colour reads, `linearDepth` / `viewPos`), per-frame transient
 * rebinding, the WebGPU depth-aspect view, and the auto-fed `fxh` uniforms (camera clip data +
 * viewport texel). It draws the shared fullscreen triangle.
 * ...
```
After
```ts
/**
 * One fullscreen draw of an `effect(uv)` fragment, reading graph handles and writing one
 *
 * The building block of every post effect. A single-shader {@link PostEffect} adds one for you;
 * a multi-pass effect adds several from its `build`, and a custom graph can add them directly.
 * The pass binds its inputs each frame and supplies the helpers {@link EffectFragment} lists, so
 * the fragment only has to define `effect(uv)`.
 * ...
```
Someone deciding whether to use the class needs to know where it fits and what it asks of their fragment, not which uniform groups and texture views it manages.

## An internal doc cut to its guard
`src/core/render-passes/DrawList.ts`

Before
```ts
  /**
   * Bumped when something a bundle baked at record time changes while the draw commands stay valid
   *
   * The render graph bumps it when a texture a pass samples swaps source, as a pooled texture does
   * when the viewport crosses into another size bucket, or dies and gives way to a placeholder.
   * `View3D._invalidateBundleCaches` bumps it when a global binding changes identity, such as the
   * shadow map, and {@link DrawList.unload} bumps it too, and so does a {@link DrawList.applyEdits}
   * ...
   * its own watermark of this one counter. WebGL never reads it, since it rebinds everything live.
   */
  bundleDirtyId: number;
```
After
```ts
  /** Bumped when a bundle must re-record while the draw commands stay valid; each pass keeps its own watermark */
  bundleDirtyId: number;
```
The list of everything that bumps the counter, and everything that doesn't need to, is a map of other files that goes stale as soon as one of them changes, and a search for `bundleDirtyId` rebuilds it. What a search can't tell a maintainer is what the counter means.

## Restating docs on an internal type, deleted
`src/core/render-passes/DrawList.ts`

Before
```ts
/**
 * Options for constructing a {@link DrawList}
 * @internal
 */
interface DrawListOptions {
  /** The renderables backing the sorted view */
  items: Mesh3DData[];
  /** Debug label applied to the GPU instance buffer */
  label: string;
```
After
```ts
interface DrawListOptions {
  items: Mesh3DData[];
  label: string;
```
The interface isn't exported, so lint wants no JSDoc on it or its members, and every line here restated a name or a type.

## A public option list rewritten around what the user sees
`src/scene/View3D.ts`

Before
```ts
/**
 * How a view or a {@link BatchedMesh3D} skips what's outside the camera's view, decided for each
 * batch every frame
 *
 * ...
 * - `'gpu'`: the view's default. Culls in a compute pass, which keeps the work off the main
 *   thread at any instance count. WebGL has no compute pass, so it culls on the CPU there.
 *   So does WebGPU in Safari and every iOS browser, except for very large batches, because
 *   WebKit charges GPU time for each indirect draw the GPU cull needs.
 * ...
 * pose can vanish near the edge of the screen. Set `'off'` on a view that shows one. Shadow maps
 * are culled too. Under `'gpu'`, a pass that sorts back to front, such as the transparent pass,
 * culls on the CPU, since the compute pass doesn't keep the order it draws in.
```
After
```ts
/**
 * How a view or a {@link BatchedMesh3D} skips what's outside the camera's view
 *
 * - `'gpu'`: culls on the GPU, off the main thread. WebGL, and Safari for all but very large
 *   batches, cull on the CPU instead.
 * - `'cpu'`: culls on the CPU every frame. Can suit a frame that waits on the GPU.
 * - `'off'`: draws everything. Suits a scene that always fits in view.
 *
 * A skinned mesh is tested at its bind pose, so an animation that carries it far from that pose
 * can make it vanish near the edge of the screen. Use `'off'` for a view that shows one.
```
The user needs to know what each mode costs and where it falls back, not why WebKit makes the fallback faster or which internal pass culls differently. The skinned-mesh gotcha stays because a user hits it and can't guess it.

## A required doc cut to the one thing the type doesn't say
`07d4815a src/scene/Model3D.ts`

Before
```ts
  /**
   * Animation player driving this model's `Skeleton`s and direct `Container3D` channels
   *
   * Present only when the source contains at least one animation clip.
   */
  public player?: AnimationPlayer;
```
After
````ts
  /**
   * Plays the file's animations on this model; `undefined` when the file has none
   * @example
   * ```ts
   * robot.player?.play('Walk');
   * ```
   */
  public player?: AnimationPlayer;
````
"Animation player" restates the type and "direct `Container3D` channels" is internal jargon; the fact worth keeping is when the property is `undefined` (the `@example` is what `require-standard-example` asks of a `@standard` member).

## A test comment moves into the `it` title
`9b181d33 src/animation/__tests__/AnimationPlayer.test.ts`

Before
```ts
  it('ignores playback on a state kept after destroy', () => {
    ...
    // Only the pre-destroy play reached the ticker, and the held pose was not rewritten.
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);
    expect(target.position.x).toBeCloseTo(2.5);
```
After
```ts
  it('ignores playback on a state kept after destroy, leaving the ticker off and the pose held', () => {
    ...
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);
    expect(target.position.x).toBeCloseTo(2.5);
```
A failing test prints its title, so the two outcomes the comment explained now appear in the report; the assertions are untouched.

## A comment inside a shader string, deleted because it holds no guard
`src/core/shader/bits/fog/exp2FogBit.ts`

Before
```ts
/**
 * Exponential-squared distance fog
 * ...
 */
...
      end: /*wgsl*/ `
  // uFogParams = (near, far, density); exp2 reads density.
  let fogD = global.uFogParams.z * input.vFogDepth;
  let fogFactor = 1.0 - exp(-fogD * fogD);
  finalColor = mix(finalColor, global.uFogColor, fogFactor);
`,
```
After
```ts
/**
 * Exponential-squared distance fog
 * @internal
 */
...
      end: /*wgsl*/ `
  let fogD = global.uFogParams.z * input.vFogDepth;
  let fogFactor = 1.0 - exp(-fogD * fogD);
  finalColor = mix(finalColor, global.uFogColor, fogFactor);
`,
```
The comment shipped in the WGSL source, the GLSL half never had it, and the next line already reads `.z`. The bit is internal, so its JSDoc doesn't take the note either; the formula is the shader code, and users read about fog on the public `FogType`.

## A guard that spans two files, a line at each end
`ce4e684d src/core/shader/ShaderBit.ts`, then `src/core/shader/codegen/parseBindingType.ts`

Before
```ts
type TextureResourceType =
  ...
/**
 * WGSL resource types that require individual `var` declarations (as opposed to uniforms which
 * are grouped into structs)
 * @internal
 */
export const RESOURCE_TYPES = new Set([
```
After
```ts
/** Must stay in step with `RESOURCE_TYPES` in `codegen/parseBindingType.ts` */
type TextureResourceType =
  ...
/**
 * Must list every type of `ResourceType` in `ShaderBit.ts`
 * @internal
 */
export const RESOURCE_TYPES = new Set([
```
A texture type added to the union but not the set would be declared as a uniform struct field instead of getting its own binding. A line at each end, naming the other, is all a maintainer needs to find both; what the set is for is plain from where it's used.

## Opting out of an example
`07d4815a src/scene/Container3D.ts`

Before
```ts
  /** Parent container, or `null` when unparented or when this node is the scene root */
  public parent: Container3D | null = null;
```
After
```ts
  /** Parent node, or `null` for a node with none, such as a view's root */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- set by addChild and removeChild, never by hand
  public parent: Container3D | null = null;
```
Users read `parent` but `addChild` and `removeChild` set it, so any example would be contrived; the directive keeps the `@standard` tier, and the reason after `--` says why there's no example.
