import type {
  ColorSource,
  ContainerChild,
  Optional,
  PointData,
  Renderer,
  Size,
  ViewContainerOptions,
  WebGLRenderer,
  WebGPURenderer,
} from 'pixi.js';
import { CubeTexture, definedProps, Matrix, ObservablePoint, Point, ViewContainer } from 'pixi.js';

import type { Scene3DSource } from '../assets/Scene3DSource';
import { Mesh3DBatch } from '../core/batcher/Mesh3DBatch';
import type { Mesh3DData } from '../core/batcher/Mesh3DData';
import { BonePit } from '../core/buffers/BonePit';
import { LightDataList } from '../core/LightDataList';
import type { RenderGraph } from '../core/render-graph/RenderGraph';
import { RenderPassBit } from '../core/render-passes/RenderPass';
import type { RenderPass } from '../core/render-passes/RenderPass';
import type { ShadowFilter, ShadowQuality } from '../core/render-passes/shadow/shadowPassUtils';
import { envSourceCubeBit } from '../core/shader/bits/envSourceCubeBit';
import { envSourceDefaultBit } from '../core/shader/bits/envSourceDefaultBit';
import { envSourceHemisphereBit } from '../core/shader/bits/envSourceHemisphereBit';
import { exp2FogBit } from '../core/shader/bits/fog/exp2FogBit';
import { exponentialFogBit } from '../core/shader/bits/fog/exponentialFogBit';
import { linearFogBit } from '../core/shader/bits/fog/linearFogBit';
import { acesToneMappingBit } from '../core/shader/bits/tonemapping/acesToneMappingBit';
import { reinhardToneMappingBit } from '../core/shader/bits/tonemapping/reinhardToneMappingBit';
import { srgbEncodeBit } from '../core/shader/bits/tonemapping/srgbEncodeBit';
import { uncharted2ToneMappingBit } from '../core/shader/bits/tonemapping/uncharted2ToneMappingBit';
import type { ShaderBit } from '../core/shader/ShaderBit';
import { ShadowDataList } from '../core/ShadowDataList';
import { EventBoundary3D } from '../events/EventBoundary3D';
import type { AncestorPickState } from '../events/FederatedEventTarget3D';
import { getAncestorPickState, PICK_BLOCKED, PICK_COVERED } from '../events/FederatedEventTarget3D';
import { Matrix4 } from '../math/matrix/Matrix4';
import type { Plane } from '../math/shapes/Plane';
import { Ray } from '../math/shapes/Ray';
import type { PointData3D } from '../math/vector/PointData3D';
import { Vector3 } from '../math/vector/Vector3';
import type { Pass3D } from '../post-processing/Pass3D';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import { StableList } from '../utils/StableList';
import { UnstableList } from '../utils/UnstableList';
import { warnOnce } from '../utils/warnOnce';
import { BatchedMesh3D } from './BatchedMesh3D';
import { Camera3D } from './cameras/Camera3D';
import { Container3D } from './Container3D';
import { DirectionalLight } from './lights/DirectionalLight';
import type { Hemisphere } from './lights/environment/Hemisphere';
import { Light } from './lights/Light';
import { Mesh3D } from './Mesh3D';
import { Model3D } from './Model3D';
import type { Model3DOptions } from './Model3D';
import { createDefaultGraph3D } from './utils/createDefaultGraph3D';
import type { DefaultGraph3DOptions } from './utils/createDefaultGraph3D';
import { frameCamera } from './utils/frameCamera';
import type { View3DGlobalData } from './View3DGlobalData';

declare global {
  namespace PixiMixins {
    /**
     * Augmentation hook for members mixed into {@link View3D}
     *
     * Declare added members here and merge their implementation onto the class
     * with pixi.js's `extensions.mixin(View3D, myMixin)`, the same pattern the
     * 2D `Container` uses. The interaction layer (`events/init.ts`) adds
     * `containsPoint`, `cursor`, and `raycast` this way.
     */
    // oxlint-disable-next-line no-empty-object-type
    interface View3D {}
    /** Augmentation hook for constructor options mixed into {@link View3DOptions} */
    // oxlint-disable-next-line no-empty-object-type
    interface View3DOptions {}
  }
}

/**
 * Maximum number of {@link Light}s the per-frame light list can hold
 * @category scene
 * @advanced
 */
export const MAX_LIGHTS = 32;

/**
 * Floats per light slot in `LightDataList` — 4 × `vec4` (16 floats)
 * @internal
 */
export const FLOATS_PER_LIGHT = 16;

/**
 * Tone-mapping applied at the end of the fragment shader for every material with `toneMapped = true`
 *
 * The sRGB display encode and the filmic curve are separate concerns:
 *   - `'aces'` / `'reinhard'` / `'uncharted2'` — a filmic curve **plus** the
 *     sRGB encode.
 *   - `'none'` — sRGB encode only, no curve: the linear-lit scene shown
 *     correctly (not darkened). What most callers want from "no tone-mapping".
 *   - `'custom'` — neither curve nor encode (no fragment-end at all): raw linear
 *     output for a user-owned post-process / output transform.
 * @example
 * ```ts
 * const view = new View3D({ width, height, toneMapping: 'reinhard' });
 * view.toneMapping = 'aces'; // switch at runtime (recompiles materials once)
 * ```
 * @see {@link View3D#toneMapping} For the runtime accessor.
 * @see {@link View3D#exposure} For the pre-curve radiance multiplier.
 * @category environment
 * @standard
 */
export type ToneMapping = 'aces' | 'reinhard' | 'uncharted2' | 'none' | 'custom';

/**
 * Per-view frustum-culling mode, resolved per batch each frame
 *
 * - `'off'`  — no culling; every instance draws.
 * - `'cpu'`  — cull + compact on the CPU, then draw the survivors.
 * - `'gpu'`  — cull + compact in a compute pass; best for large instanced batches.
 * - `'auto'` — pick per batch by instance count (off → cpu → gpu). The default.
 *
 * WebGPU only for `'gpu'`; on WebGL it falls back to `'cpu'`. Culling never changes
 * what's visible — it only removes off-screen geometry from the draw.
 * @category scene
 * @standard
 */
export type CullMode = 'off' | 'auto' | 'cpu' | 'gpu';

const TONE_MAPPING_BITS: Record<ToneMapping, ShaderBit | null> = {
  aces: acesToneMappingBit,
  reinhard: reinhardToneMappingBit,
  uncharted2: uncharted2ToneMappingBit,
  none: srgbEncodeBit,
  custom: null,
};

/**
 * Distance-fog falloff curve
 *
 * - `linear`      — `smoothstep(near, far, depth)` between near and far.
 * - `exponential` — `1 - exp(-density * depth)`. Soft haze.
 * - `exp2`        — `1 - exp(-(density * depth)²)`. Atmospheric.
 * @example
 * ```ts
 * new View3D({ width, height, fog: { type: 'exponential', color: 0xadb2ba, density: 0.18 } });
 * ```
 * @see {@link Fog} For the full fog configuration object.
 * @category environment
 * @standard
 */
export type FogType = 'linear' | 'exponential' | 'exp2';

const FOG_BITS: Record<FogType, ShaderBit> = {
  linear: linearFogBit,
  exponential: exponentialFogBit,
  exp2: exp2FogBit,
};

// Screen-mapping scratch — module-level so per-call conversions don't allocate.
const _screenMatrix2D = new Matrix();
const _screenPoint = new Point();
const _projMatrix = new Matrix4();
const _camMatrix = new Matrix4();
const _screenVec = new Vector3();
const _screenRay = new Ray();

/**
 * Distance fog state on a {@link View3D}
 *
 * All fields are optional; missing fields fall back to sensible defaults at sync time:
 * - `type` → `'linear'`
 * - `color` → gray (`0xcccccc`, the View's initial uniform value)
 * - `near` → `0`
 * - `far` → `99999999` (effectively no fog for missing far)
 * - `density` → `0` (effectively no fog for missing density)
 *
 * `color` accepts any {@link ColorSource} (hex, CSS string, `Color`,
 * `[r,g,b]`, `{r,g,b}`) — same shape as `material.baseColor` and Pixi's
 * `tint`. The user's value is stored as-is and isn't normalised in the
 * setter; conversion to RGB happens at sync time.
 *
 * Mutating `near` / `far` / `density` / `color` is a free uniform update
 * on the next frame.
 *
 * `type` is `readonly` because changing it requires a shader-variant
 * rebuild that the View needs to detect. To switch curves, assign a fresh
 * fog object: `view3d.fog = { type: 'exp2', density: 0.05, ... }`.
 * @example
 * ```ts
 * // Linear haze between 30 and 55 world units:
 * view.fog = { type: 'linear', color: 0xadb2ba, near: 30, far: 55 };
 *
 * // Free per-frame tweak — mutate in place, no shader recompile:
 * view.fog.far = 80;
 *
 * // Switching curve needs a fresh object (`type` is readonly):
 * view.fog = { type: 'exp2', color: 0xadb2ba, density: 0.05 };
 *
 * view.fog = null; // disable fog entirely
 * ```
 * @see {@link FogType} For the available falloff curves.
 * @see {@link View3D#fog} For the runtime accessor and recompile semantics.
 * @category environment
 * @standard
 */
export interface Fog {
  /**
   * Falloff curve
   *
   * `readonly` — switching curves requires re-assigning `view3d.fog` so the shader
   * variant can be rebuilt.
   * @default 'linear'
   */
  readonly type?: FogType;
  /**
   * Fog color, as any {@link ColorSource}
   *
   * Authored in sRGB, like every other colour on the API. Fog is mixed in
   * linear light before tone mapping, so distant surfaces converge on this
   * colour *through* the view's tone curve rather than landing on it exactly.
   * @default 0xcccccc
   */
  color?: ColorSource;
  /**
   * `linear` only — distance at which fog begins
   * @default 0
   */
  near?: number;
  /**
   * `linear` only — distance at which fog is fully opaque
   * @default 99999999
   */
  far?: number;
  /**
   * `exponential` / `exp2` only — falloff density; `0` means no fog
   * @default 0
   */
  density?: number;
}

/**
 * Constructor options for {@link View3D}
 *
 * Every field is optional and has a default documented on its member. Pass `width` and
 * `height` to match the drawing surface, like a pixi.js `TilingSprite`.
 *
 * Inherited pixi container options (`label`, `position`, `alpha`, `parent`,
 * `eventMode`, `cursor`, `hitArea`, the `on*` handlers, …) are applied too.
 * Event options land after the View's boundary is set up, so passing
 * `eventMode: 'none'` / `'passive'` disables the View's interaction just as a
 * runtime assignment would.
 * @example
 * ```ts
 * const view = new View3D({
 *   width: 1280,
 *   height: 720,
 *   anchor: 0.5, // place the View's origin at its center
 *   shadowQuality: 'high',
 *   toneMapping: 'aces',
 *   exposure: 1.2,
 *   fog: { type: 'linear', color: 0xadb2ba, near: 30, far: 55 },
 *   environment: { skyColor: 0x88ccff, groundColor: 0x553311 },
 * });
 * ```
 * @see {@link View3D} For the constructed scene root and runtime accessors.
 * @typeParam TRoot - Type of the {@link View3DOptions#root | root} container, carried through to
 * {@link View3D#root}. Inferred from the `root` you pass.
 * @category scene
 * @standard
 */
export interface View3DOptions<TRoot extends Container3D = Container3D>
  extends PixiMixins.View3DOptions, Omit<ViewContainerOptions, 'children' | 'isRenderGroup'> {
  /**
   * Root 3D container
   * @default new Container3D()
   */
  root?: TRoot;
  /**
   * Camera for the scene, added to {@link View3DOptions#root | root} when it isn't in the graph yet
   * @default new Camera3D()
   */
  camera?: Camera3D;
  /**
   * Width of the 3D viewport in pixels
   *
   * With {@link View3DOptions#autoResize | autoResize} on, this is only the size reported
   * before the first render.
   * @default 256
   */
  width?: number;
  /**
   * Height of the 3D viewport in pixels; see {@link View3DOptions#width | width}
   * @default 256
   */
  height?: number;
  /**
   * Match the renderer's screen size on every render, following it when the canvas resizes
   *
   * The size is only known once the View has rendered; before that it reports `width` /
   * `height`.
   * @default false
   */
  autoResize?: boolean;
  /**
   * Anchor point for positioning
   * @default 0
   */
  anchor?: PointData | number;
  /**
   * Shadow map quality — `'medium'` is 1024px
   * @default 'medium'
   */
  shadowQuality?: ShadowQuality;
  /**
   * Shadow edge-filtering kernel for shadows this view samples
   *
   * See {@link ShadowFilter} for the quality/cost tiers.
   * @default 'pcf'
   */
  shadowFilter?: ShadowFilter;
  /**
   * Environmental fill source: an IBL `CubeTexture`, a {@link Hemisphere} sky/ground
   * gradient, or `null` for no fill
   *
   * See {@link View3D#environment}.
   * @default null
   */
  environment?: CubeTexture | Hemisphere | null;
  /**
   * Background skybox
   * @default null
   */
  background?: CubeTexture;
  /**
   * Tone-mapping curve applied to lit fragments
   *
   * Materials can opt out by setting `material.toneMapped = false`.
   * @default 'aces'
   */
  toneMapping?: ToneMapping;
  /**
   * Linear scene-radiance multiplier applied immediately before the tone-mapping curve
   *
   * Combines naturally with each curve's internal calibration constants.
   * @default 1.0
   */
  exposure?: number;
  /**
   * Distance fog — pass a {@link Fog} literal to enable; omit (or set to `null` later)
   * to disable
   *
   * Mutating the stored object's `near` / `far` / `density` / `color` is a uniform
   * update and free; switching `type` requires re-assigning `view3d.fog` so the shader
   * variant can be rebuilt.
   */
  fog?: Fog;
  /**
   * Frustum-culling mode for this view's batches — see {@link CullMode}
   * @default 'auto'
   */
  cull?: CullMode;
  /**
   * Render the scene into an offscreen colour+depth transient and composite it back to
   * the screen, instead of drawing straight to the canvas
   *
   * Implied by any enabled post effect in {@link View3DOptions#passes}; set it explicitly to
   * alpha-composite an inset over 2D without one. Forwarded to a custom
   * {@link View3DOptions#graph} builder in its options.
   * @default false
   */
  composite?: boolean;
  /**
   * Passes and post effects added to this view's pipeline
   *
   * Sugar for assigning {@link View3D#passes} after construction.
   */
  passes?: readonly Pass3D[];
  /**
   * Build the render graph for this view
   *
   * Runs once on first render with the resolved renderer; the returned graph drives
   * every subsequent frame.
   *
   * Omit to use {@link createDefaultGraph3D}. Adding passes to the standard pipeline
   * needs no builder — see {@link View3DOptions#passes}. This callback is the escape hatch
   * for a different pipeline: start from `createDefaultGraph3D` and append, or instantiate
   * a bare {@link RenderGraph}. Forward `options` so `passes` and `composite` keep working.
   * @example Modify the default graph
   * ```ts
   * new View3D({
   *   width,
   *   height,
   *   graph: (renderer, options) => {
   *     const { graph } = createDefaultGraph3D(renderer, options);
   *     graph.addPass(new MyOutlinePass({ renderer }));
   *     return graph;
   *   },
   * });
   * ```
   */
  graph?: (renderer: WebGLRenderer | WebGPURenderer, options: DefaultGraph3DOptions) => RenderGraph;
}

/**
 * Options for {@link View3D.from}: every {@link View3DOptions} field except `root` (the model
 * built from the source is the root), the per-instance {@link Model3DOptions} fields, and the
 * default-light switch
 * @example
 * ```ts
 * const view = View3D.from(source, {
 *   width: 800,
 *   height: 600,
 *   toneMapping: 'reinhard',
 *   scene: 'Showroom',
 *   autoPlay: true,
 * });
 * ```
 * @see {@link View3D.from} For what the camera and light defaults do.
 * @category scene
 * @standard
 */
export interface View3DFromOptions
  extends
    Omit<View3DOptions, 'root'>,
    Pick<Model3DOptions, 'scene' | 'castShadow' | 'receiveShadow' | 'autoUpdate' | 'autoPlay'> {
  /**
   * Add a white {@link DirectionalLight} under the camera when the file brings no lights of its own
   *
   * Set to `false` to light the scene yourself.
   * @default true
   */
  light?: boolean;
}

// Merges the PixiMixins hook into the class type so members applied with
// `extensions.mixin` surface on every View3D. The type parameter list has to match
// the class's for the merge to be legal.
// oxlint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, pixi3d/require-export-jsdoc, pixi3d/require-member-api-doc, no-unused-vars
export interface View3D<TRoot extends Container3D = Container3D> extends PixiMixins.View3D {}

/**
 * Root of a 3D scene and the bridge between pixi.js's 2D display list and the 3D renderer
 *
 * A `View3D` is itself a pixi.js `ViewContainer`, so you add it to the stage like any
 * other display object; everything 3D lives under its {@link View3D#root | root}
 * container.
 *
 * A View owns the scene {@link Camera3D | camera}, the per-frame light and
 * shadow data, and the View-wide shading settings (tone mapping, exposure,
 * fog, environment fill, background skybox). Add lights and meshes by
 * parenting them under `root` (or any descendant) — the View tracks them
 * automatically as the scene graph changes.
 *
 * Settings that change a shader variant ({@link View3D#toneMapping | toneMapping},
 * `fog.type`, the {@link View3D#environment | environment} kind) recompile
 * cached material shaders on the next frame; value-only changes
 * ({@link View3D#exposure | exposure}, `fog.near`, swapping two cube maps)
 * are free per-frame uniform updates.
 *
 * The View is also the pointer-interaction bridge. Opt a node in with
 * {@link Container3D#eventMode | eventMode} (or `interactive`) and it receives
 * the standard pixi pointer event family — `pointerdown`, `click`,
 * `pointerenter`, capture phases, `on*` handler properties — ray-picked against
 * its {@link Container3D#hitVolume | hitVolume}. Cast a ray yourself with
 * {@link View3D#raycast | raycast}.
 * @example
 * ```ts
 * import { Application } from 'pixi.js';
 * import { View3D, DirectionalLight } from '@pixi/3d';
 *
 * const app = new Application();
 * await app.init({ resizeTo: window });
 *
 * // autoResize: the View fills the screen and follows canvas resizes.
 * const view = new View3D({ autoResize: true, shadowQuality: 'high', toneMapping: 'aces' });
 * app.stage.addChild(view); // a View3D is a pixi.js display object
 *
 * view.camera.position.set(0, 2.5, 7);
 *
 * const light = new DirectionalLight({ intensity: 3, castShadow: true });
 * view.root.addChild(light);
 * view.root.addChild(mesh); // any Mesh3D
 *
 * // The default: a fixed size, here an inset.
 * const inset = new View3D({ width: 320, height: 240 });
 * ```
 * @see {@link Container3D} For the scene-graph node type used by `root`.
 * @see {@link Camera3D} For the scene camera.
 * @see {@link Hemisphere} For the non-IBL environment fill alternative.
 * @see {@link Fog} For distance-fog configuration.
 * @see {@link View3DOptions} For all constructor options.
 * @see {@link View3D#events} For the pointer-interaction boundary.
 * @typeParam TRoot - Type of {@link View3D#root}, inferred from the `root` passed to the
 * constructor: `new View3D({ root: model })` is a `View3D<Model3D>`, so `view.root` keeps the
 * model's own API. Defaults to {@link Container3D}.
 * @category scene
 * @standard
 */
export class View3D<TRoot extends Container3D = Container3D> extends ViewContainer<View3DGlobalData> {
  /**
   * Default {@link View3DOptions} merged under every constructor call
   *
   * `new View3D(opts)` resolves as `{ ...View3D.defaultOptions, ...opts }`. Mutate to
   * change the defaults process-wide.
   *
   * `root` / `camera` are created fresh per instance, so they are intentionally absent here.
   * @example
   * ```ts
   * View3D.defaultOptions.shadowQuality = 'high';
   * View3D.defaultOptions.toneMapping = 'reinhard';
   * const view = new View3D(); // picks up the overrides above
   * ```
   */
  public static defaultOptions: View3DOptions = {
    width: 256,
    height: 256,
    anchor: 0,
    shadowQuality: 'medium',
    shadowFilter: 'pcf',
    toneMapping: 'aces',
    exposure: 1.0,
    autoResize: false,
  };

  /** Always `false` — 3D content parents under {@link View3D#root | root}, not a pixi child list */
  public override allowChildren = false;

  /**
   * pixi.js render-pipe id; routes this View to `View3DPipe` / `View3DGlPipe`
   * @internal
   */
  public override readonly renderPipeId: string = 'view3d';
  /**
   * Set by the render pipe once this View has been batched
   * @internal
   */
  public override batched = false;

  /**
   * Root of the 3D scene graph
   *
   * Parent lights, meshes, and cameras under this container (or any descendant) and the
   * View indexes them automatically. Created for you when not supplied via options.
   *
   * Typed as whatever you passed as `root`, so a View built around a {@link Model3D} keeps
   * the model's API here.
   * @example
   * ```ts
   * view.root.addChild(mesh);
   * view.root.addChild(light);
   *
   * const modelView = new View3D({ root: new Model3D(source) });
   * modelView.root.player?.play('Wave'); // root is a Model3D
   * ```
   */
  public root: TRoot;

  /**
   * The 3D event boundary owning this View's interaction state
   *
   * Holds the pick list, the per-pointer records, hover/press tracking, and the
   * ray-pick pipeline — the 3D counterpart to pixi.js's `EventBoundary`. The
   * interaction members on the View itself (`containsPoint`, `cursor`,
   * `raycast`) are mixed in and delegate here.
   * @example
   * ```ts
   * const view = new View3D({ width: 800, height: 600 });
   * view.events.enableGlobalMoveEvents = false; // skip globalpointermove dispatch
   * ```
   * @see {@link EventBoundary3D} For the pick and dispatch implementation.
   * @see {@link View3D#raycast} For a one-off ray cast that dispatches nothing.
   */
  public readonly events: EventBoundary3D;

  private _camera!: Camera3D;
  private readonly _anchor: ObservablePoint = new ObservablePoint(this, 0, 0);
  private _width: number;
  private _height: number;
  /**
   * Whether the View matches the renderer's screen size on every render
   *
   * Off by default. Setting {@link View3D#width | width}, {@link View3D#height | height} or
   * {@link View3D#setSize | setSize} turns it off: an explicit size is yours to keep. The
   * screen size is read at the start of each render, before the frame's bounds and
   * instructions are built, so a View that has not rendered yet still reports its `width` /
   * `height`.
   * @example
   * ```ts
   * const view = new View3D({ autoResize: true }); // fills the screen
   * view.setSize(320, 240); // now an inset; autoResize is false
   * view.autoResize = true; // back to following the screen on the next render
   * ```
   * @default false
   */
  public autoResize: boolean;
  /** Set by {@link View3D.from} on an auto-sized View: frame the model once the real aspect is known */
  private _frameOnResize = false;
  private _userOnRender: ((renderer: Renderer) => void) | null = null;

  /**
   * The per-frame hook pixi runs before a frame's transforms, bounds, and instructions are built
   *
   * The screen size is adopted here so 2D consumers of the View's rect (filters, culling,
   * hit-testing) see the new size in the same frame.
   * @param renderer - Renderer drawing this frame.
   * @internal
   */
  public override readonly _onRender = (renderer: Renderer): void => {
    if (this.autoResize) this._resize(renderer.screen.width, renderer.screen.height);
    this._userOnRender?.(renderer);
  };

  /** Callback run at the start of every render this View takes part in; `null` removes it */
  override get onRender(): ((renderer: Renderer) => void) | null {
    return this._userOnRender;
  }

  /**
   * Sets the per-render callback
   * @param func - Callback run at the start of every render; `null` removes it.
   */
  override set onRender(func: ((renderer: Renderer) => void) | null) {
    this._userOnRender = func ?? null;
  }

  /**
   * Every {@link Light} currently in the scene, kept in sync as lights are added to /
   * removed from the scene graph
   *
   * Treat as read-only — parent lights under {@link View3D#root | root} to add them; the
   * View maintains this list.
   */
  public lights: Light[] = [];
  /**
   * Shadow map quality — `'medium'` is 1024px
   * @default 'medium'
   */
  public shadowQuality: ShadowQuality;
  private _shadowFilter: ShadowFilter = 'pcf';
  /**
   * Linear scene-radiance multiplier applied immediately before the tone-mapping curve
   *
   * A free per-frame uniform update (no recompile). Read every frame by `View3DPipe` and
   * `View3DGlPipe` into the global `uExposure` uniform.
   * @example
   * ```ts
   * view.exposure = 1.5; // brighten the whole scene before tone-mapping
   * ```
   * @see {@link View3D#toneMapping} For the curve applied after exposure.
   * @default 1.0
   */
  public exposure = 1.0;
  /**
   * Optional cubemap background (skybox); `null` disables it
   *
   * Rendered as a dedicated background pass — it is not a Mesh and is not part
   * of the scene graph, so it incurs no per-frame transform/culling work.
   * Often set to the same `CubeTexture` used for {@link View3D#environment}.
   * @example
   * ```ts
   * const env = await Assets.load<CubeTexture>('env.cubemap');
   * view.environment = env;
   * view.background = env; // show the same cube map behind the scene
   * ```
   */
  public background: CubeTexture | null = null;

  private _toneMapping: ToneMapping = 'aces';
  /**
   * Cached resolved tone-mapping bit; lookup happens once per setter call
   * @internal
   */
  public _toneMappingBit: ShaderBit | null = TONE_MAPPING_BITS.aces;

  private _fog: Fog | null = null;
  /**
   * Cached fog bit resolved from `_fog?.type`; consumed by MaterialSystemGpu
   * @internal
   */
  public _fogBit: ShaderBit | null = null;

  private _environment: CubeTexture | Hemisphere | null = null;
  /**
   * Env-source bit selected from the current environment kind, consumed by
   * `Material3D.getPrimaryDescriptor`
   *
   * Always non-null — a default no-env bit covers the null case so
   * `sampleEnvironment` is always resolvable in lit shaders.
   * @internal
   */
  public _envBit: ShaderBit = envSourceDefaultBit;

  /**
   * Stable-index slot allocator for scene Mesh3Ds
   *
   * Indices survive removal (freed slots are recycled via a free-list), so
   * pass views, ID buffers, and the store buffer can safely reference meshes
   * by their slot index without invalidation.
   * @internal
   */
  public readonly _meshSlots = new StableList<Mesh3D>();

  /**
   * Dense iteration list of every Mesh3D currently in the scene
   *
   * Swap-and-pop on removal keeps it hole-free, so the pipe can iterate
   * all meshes without null checks or indirection. Add/remove is O(1).
   */
  public meshes = new UnstableList<Mesh3D>('_allMeshIndex');
  /**
   * Dense list of every skinned (`skeleton`-bearing) Mesh3D, kept in sync as meshes are
   * added/removed
   *
   * Drives the skinning pass.
   * @internal
   */
  public _skinnedMeshes = new UnstableList<Mesh3D>('_skinnedMeshIndex');

  /**
   * Dense list of every morphed (`mesh.morph` present) Mesh3D, kept in sync as meshes
   * are added/removed
   *
   * Drives the shared morph store's prepare pass.
   * @internal
   */
  public _morphedMeshes = new UnstableList<Mesh3D>('_morphedMeshIndex');

  /**
   * Scene batch — wraps the scene's meshSlots array
   *
   * Owns the per-batch store buffer, ID buffers, and per-pass draw lists for all scene
   * Mesh3Ds. Always lives at meshBatches[0].
   * @internal
   */
  public readonly _sceneBatch: Mesh3DBatch = new Mesh3DBatch({
    items: this._meshSlots.items as Mesh3DData[],
  });

  /**
   * All batches: [0] is always the scene batch, user batches follow
   * @internal
   */
  public readonly _meshBatches: Mesh3DBatch[] = [this._sceneBatch];

  /**
   * Bumped whenever `_meshBatches` gains or loses a batch
   *
   * Consumers holding per-batch state (the shadow pass's per-light records) reconcile
   * against the live list only when this moves, instead of re-scanning it every frame.
   * @internal
   */
  public _meshBatchesDirtyId = 0;

  /**
   * Frustum-culling mode for this view's batches — see {@link CullMode}
   *
   * Fixed at construction: producers resolve from it during draw-work rebuilds, so there
   * is no live-switch path — create the View3D with the mode you want (`'auto'` adapts
   * by itself).
   * @default 'auto'
   */
  public readonly cull: CullMode;

  /**
   * Bit → pass lookup, rebuilt by `_ensureInitialized`
   * @internal
   */
  public readonly passByBit: Record<number, RenderPass> = Object.create(null);

  /**
   * OR of every installed pass's bit, consumed by the pipe's dirty-hook dispatch
   * @internal
   */
  public _dirtyHookBits = 0;

  /**
   * Render graph orchestrating this view's pass list
   *
   * Built on first `_ensureInitialized` from either the user-supplied builder
   * (`View3DOptions.graph`) or {@link createDefaultGraph3D}.
   * @internal
   */
  public _graph!: RenderGraph;

  private _passesInitialized = false;

  /** User-supplied graph builder from {@link View3DOptions#graph}, or `undefined` to use the default factory */
  private readonly _buildGraph?: (
    renderer: WebGLRenderer | WebGPURenderer,
    options: DefaultGraph3DOptions,
  ) => RenderGraph;

  /** Composite mode: scene → offscreen transient → blit to screen (see {@link View3DOptions#composite}) */
  private readonly _composite: boolean;

  /** User passes — the array is a transaction (see {@link View3D#passes}) */
  private _passes: readonly Pass3D[] = [];

  /** Enabled-flag bitmask the current graph was built with; a per-frame mismatch triggers a rebuild */
  private _passesEnabledKey = 0;

  /**
   * Per-frame packed light list; its array is the value of the `uLightData` uniform
   * @internal
   */
  public readonly _lightDataList = new LightDataList();
  /**
   * Per-frame packed shadow slots; its array is the value of the `uShadowData` uniform
   * @internal
   */
  public readonly _shadowDataList = new ShadowDataList();
  /**
   * Whether this view has packed a light casting shadows, so its lit shaders compile the shadow
   * sampler
   *
   * Off until a packed light first casts, so a view that never has shadows never carries the
   * sampling code. It never turns back off: a light that toggles its shadow would otherwise
   * recompile every lit shader on each toggle. Set by `_syncShadowSampling`.
   * @internal
   */
  public _hasShadows = false;
  /**
   * Scene-wide bone-matrix arena for skinned meshes
   * @internal
   */
  public _bonePit = new BonePit();

  /**
   * Last-seen `_bonePit` `bufferVersion`
   *
   * Compared each frame in `updateView3DScene`; growth invalidates every batch's draw
   * caches, since the bone buffer is shared by all of them.
   * @internal
   */
  public _lastBonePitBufferVersion = 0;

  /**
   * Last-seen `GeometryAtlasPool.bufferVersion`, watched by the morph re-stamp in
   * `updateView3DScene`
   *
   * A morphed geometry's store row caches the atlas `baseVertex` the shader subtracts to get
   * a geometry-local vertex id, and a compaction moves that base without dirtying any mesh.
   *
   * Deliberately its own watermark rather than the one on the renderer's `View3DGlobalData`;
   * that one is *claimed* by `detectSharedCacheInvalidation`, so sharing it would mean
   * whichever consumer ran first ate the signal.
   * @internal
   */
  public _lastAtlasBufferVersion = 0;

  /**
   * Transform-pass work queue bucketed by `_relativeSceneDepth` so ancestors are
   * processed before descendants
   *
   * Filled by `View3D._onChildUpdate`.
   * @internal
   */
  public readonly _childrenToUpdate: Record<number, { list: Container3D[]; index: number }> = Object.create(null);
  /**
   * Monotonic tick used to dedupe transform updates within a frame
   * @internal
   */
  public _updateTick = 0;

  /**
   * Creates a new `View3D`
   *
   * Add the returned instance to a pixi.js container (typically `app.stage`) to render it.
   * @example
   * ```ts
   * const view = new View3D({ width: 800, height: 600 });
   * app.stage.addChild(view);
   * ```
   * @param options - construction options; see {@link View3DOptions}
   */
  constructor(options: View3DOptions<TRoot> = {}) {
    super({});

    const {
      root,
      camera,
      width,
      height,
      anchor,
      shadowQuality,
      shadowFilter,
      environment,
      background,
      toneMapping,
      exposure,
      fog,
      cull,
      composite,
      graph,
      passes,
      parent,
      autoResize,
      ...rest
    } = { ...View3D.defaultOptions, ...definedProps(options) };

    // Constructed before `_attach(root)` below: attaching a pre-assembled
    // subtree registers its pick-candidate nodes on the boundary.
    this.events = new EventBoundary3D(this);

    this.shadowQuality = shadowQuality!;
    this._shadowFilter = shadowFilter!;
    this.environment = environment ?? null;
    this.background = background ?? null;
    this._toneMapping = toneMapping!;
    this._toneMappingBit = TONE_MAPPING_BITS[toneMapping!];
    this.exposure = exposure!;
    this._composite = composite ?? false;
    this._buildGraph = graph;
    if (passes) this._passes = passes.slice();

    if (fog) this.fog = fog;

    this.anchor = anchor!;
    this._width = width!;
    this._height = height!;
    this.autoResize = autoResize!;

    // No root given means TRoot resolved to its `Container3D` default, which the compiler
    // can't see from inside the generic body.
    this.root = (root ?? new Container3D()) as TRoot;
    this._attach(this.root);

    this.cull = cull ?? 'auto';
    this.camera = camera ?? new Camera3D();

    // Inherited pixi container options land last: `cursor` / `hitArea` delegate
    // to `this.events` (which must exist), and a user-supplied `eventMode` has to
    // overwrite the 'static' the boundary forces — 'none' / 'passive' are the
    // documented way to turn the View's interaction off (see View3DEvents).
    Object.assign(this, rest);
    parent?.addChild(this);
  }

  /**
   * Builds a View whose root is a {@link Model3D} of `source`, with a camera and light ready to
   * render it
   *
   * The camera is, in order: `options.camera` as given; the file's first camera node
   * ({@link Model3D#cameras}); or a default {@link Camera3D} placed on the +Z side of the
   * model, facing it, at the closest distance where the model's bounds fit the viewport. An
   * auto-sized View ({@link View3DOptions#autoResize | autoResize}) places that camera on its
   * first render, once the real aspect is known. A file with no lights of its own gets a
   * {@link DirectionalLight} parented under the camera, so it lights whatever the camera looks
   * at; pass `light: false` to skip it.
   * @example
   * ```ts
   * const view = View3D.from(await Assets.load('robot.glb'), { autoResize: true, environment });
   * app.stage.addChild(view);
   * view.root.player?.play('Wave');
   * ```
   * @param source - The loaded glTF / GLB to build the scene from.
   * @param options - View options plus the per-instance model options; see {@link View3DFromOptions}.
   * @returns The View, with `root` typed as the model it holds
   */
  public static from(source: Scene3DSource, options: View3DFromOptions = {}): View3D<Model3D> {
    const { scene, castShadow, receiveShadow, autoUpdate, autoPlay, light, ...viewOptions } = options;
    const root = new Model3D({ source, scene, castShadow, receiveShadow, autoUpdate, autoPlay });
    const camera = viewOptions.camera ?? root.cameras[0];
    const view = new View3D({ ...viewOptions, root, camera });

    // An auto-sized View only learns its aspect on the first render, so its framing waits for it.
    if (!camera) {
      if (view.autoResize) view._frameOnResize = true;
      else frameCamera(view.camera, root, view.width / view.height);
    }
    if (light !== false && !view.lights.length) view.camera.addChild(new DirectionalLight());

    return view;
  }

  /**
   * The active scene camera
   *
   * A default {@link Camera3D} is created when none is supplied via options.
   *
   * Assigning a camera adds it to {@link View3D#root | root} when it isn't
   * already in this View's scene graph. Throws when the camera is parented
   * under a `Container3D` belonging to a different View — re-parent it (or
   * its ancestor) under `view.root` first.
   * @example
   * ```ts
   * view.camera.fov = 45;
   * view.camera.position.set(0, 2.5, 7);
   *
   * // Swap in a custom camera:
   * const cam = new Camera3D();
   * view.root.addChild(cam);
   * view.camera = cam;
   * ```
   */
  get camera(): Camera3D {
    return this._camera;
  }

  /**
   * Sets the active camera, adding it to {@link View3D#root | root} when it isn't already in this View's graph
   * @param value - Camera to render through; throws if it's parented under another View's graph.
   */
  set camera(value: Camera3D) {
    if (this._camera === value) return;
    this._camera = value;

    if (value._view3d === this) return;

    if (value.parent !== null) {
      throw new Error(
        "Camera3D is parented under a Container3D that isn't in this View3D's scene graph. " +
          'Add the camera (or its ancestor) to view3d.root first.',
      );
    }

    this.root.addChild(value);
  }

  /**
   * Normalised anchor for the View's 2D bounds, matching pixi.js sprite-anchor semantics
   *
   * `0` puts the origin at the top-left corner, `0.5` centers it, `1` puts it at the
   * bottom-right. Accepts a scalar (applied to both axes) or a `PointData`.
   * @example
   * ```ts
   * view.anchor = 0.5;            // centered
   * view.anchor = { x: 0, y: 1 }; // bottom-left origin
   * ```
   */
  get anchor(): ObservablePoint {
    return this._anchor;
  }

  /**
   * Sets the anchor from a scalar (applied to both axes) or a `PointData`
   * @param value - Origin as a fraction of the View's size: `0` top-left, `1` bottom-right.
   */
  set anchor(value: PointData | number) {
    if (typeof value === 'number') {
      this._anchor.set(value);
    } else {
      this._anchor.copyFrom(value);
    }
  }

  /**
   * Width of the 3D viewport in pixels
   *
   * Unlike a plain pixi.js `Container`, setting it resizes the viewport instead of scaling
   * the View, the same as `TilingSprite.width`.
   * @example
   * ```ts
   * view.width = 320;
   * ```
   * @see {@link View3D#setSize} For setting width and height in one update.
   */
  override get width(): number {
    return this._width;
  }

  /**
   * Resizes the viewport's width and turns {@link View3D#autoResize | autoResize} off
   * @param value - Width in pixels.
   */
  override set width(value: number) {
    this.setSize(value, this._height);
  }

  /**
   * Height of the 3D viewport in pixels
   *
   * Unlike a plain pixi.js `Container`, setting it resizes the viewport instead of scaling
   * the View, the same as `TilingSprite.height`.
   * @example
   * ```ts
   * view.height = 240;
   * ```
   * @see {@link View3D#setSize} For setting width and height in one update.
   */
  override get height(): number {
    return this._height;
  }

  /**
   * Resizes the viewport's height and turns {@link View3D#autoResize | autoResize} off
   * @param value - Height in pixels.
   */
  override set height(value: number) {
    this.setSize(this._width, value);
  }

  /**
   * Resizes the 3D viewport in one update and turns {@link View3D#autoResize | autoResize} off
   * @example
   * ```ts
   * view.setSize(512); // 512 × 512
   * view.setSize({ width: 800, height: 600 });
   * ```
   * @param value - Width in pixels, or an object with `width` and optional `height`.
   * @param height - Height in pixels; defaults to the width.
   */
  public override setSize(value: number | Optional<Size, 'height'>, height?: number): void {
    this.autoResize = false;

    if (typeof value === 'object') {
      height = value.height ?? value.width;
      value = value.width;
    }

    this._resize(value, height ?? value);
  }

  private _resize(width: number, height: number): void {
    if (width === this._width && height === this._height) return;

    this._width = width;
    this._height = height;

    this.onViewUpdate();

    if (this._frameOnResize) {
      this._frameOnResize = false;
      frameCamera(this._camera, this.root, width / height);
    }
  }

  /**
   * Returns the viewport size in pixels
   * @example
   * ```ts
   * const { width, height } = view.getSize();
   * ```
   * @param out - Object to write into instead of allocating a new one.
   * @returns The `out` object, or a new one.
   */
  public override getSize(out?: Size): Size {
    out ||= {} as Size;
    out.width = this._width;
    out.height = this._height;

    return out;
  }

  /**
   * Projects a 3D world-space point (the space of {@link View3D#root}) to 2D global
   * coordinates — the same space as `event.global` and pixi.js's `toGlobal`, so the result
   * can be assigned directly to a 2D display object's position or compared against pointer
   * events. Accounts for this View's {@link View3D#anchor | anchor}, its 2D transform in the
   * stage, and the camera's {@link Camera3D#viewport | viewport}.
   *
   * Returns `null` when a perspective camera has the point at or behind its plane, where the
   * projection is undefined — the cue to hide a tracking label. Orthographic projection is
   * defined everywhere and never returns `null`.
   *
   * A point from a container's local space goes through {@link Container3D#toGlobal} first.
   * @param position - world-space point to project.
   * @param out - 2D point the result is written into. Defaults to a new `Point`.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @example
   * ```ts
   * const label = new Text({ text: 'player' });
   * app.stage.addChild(label);
   *
   * app.ticker.add(() => {
   *   const p = view3d.worldToScreen(mesh.getGlobalPosition());
   *   label.visible = p !== null;
   *   if (p) label.position.copyFrom(p);
   * });
   * ```
   * @see {@link View3D#screenToRay} / {@link View3D#screenToWorld} For the reverse direction.
   */
  public worldToScreen<P extends PointData = Point>(position: PointData3D, out?: P, skipUpdate = false): P | null {
    const camera = this._camera;

    // Camera space first: the behind-camera test is a plain z sign check there, safely away
    // from the perspective divide blowing up as w approaches 0.
    camera.getGlobalTransform(_camMatrix, skipUpdate);
    _camMatrix.getInverse(_camMatrix);
    _screenVec.copyFrom(position).applyAffineMatrix4(_camMatrix);

    if (camera.mode === 'perspective' && _screenVec.z >= 0) return null;

    const width = this._width;
    const height = this._height;
    const { x: vx, y: vy, width: vw, height: vh } = camera.viewport;
    const localW = vw * width;
    const localH = vh * height;

    // A zero-area view or camera viewport has no defined mapping — without this guard the
    // divisions below would return a silently-NaN point.
    if (!(localW > 0) || !(localH > 0)) {
      warnOnce('View3D.worldToScreen:degenerate', 'View3D.worldToScreen: view size or camera viewport has zero area.');

      return null;
    }

    camera.computeProjection(localW / localH, _projMatrix);
    _screenVec.applyMatrix4(_projMatrix);

    // NDC → View3D-local 2D (anchor + camera-viewport aware; y flipped to pixi's y-down).
    _screenPoint.x = (vx - this._anchor.x) * width + (_screenVec.x * 0.5 + 0.5) * localW;
    _screenPoint.y = (vy - this._anchor.y) * height + (0.5 - _screenVec.y * 0.5) * localH;

    // View3D-local 2D → pixi global through the 2D worldTransform chain.
    return this.getGlobalTransform(_screenMatrix2D, skipUpdate).apply(_screenPoint, out);
  }

  /**
   * Builds the world-space {@link Ray} that passes through a 2D global point — the space of
   * `event.global` and pixi.js's `toGlobal`. The exact inverse of
   * {@link View3D#worldToScreen | worldToScreen}: every world point on the returned ray
   * projects back to `position`.
   *
   * With a perspective camera the ray starts at the camera and passes through the
   * corresponding near-plane point; with an orthographic camera rays are parallel to the
   * camera's forward axis and start on the camera plane. In both modes `ray.at(t)` is the
   * point `t` world units along the ray, measured from the camera — note that for a
   * perspective camera this is distance along the (possibly slanted) ray, not view-axis
   * depth: a fixed `t` across the screen sweeps a sphere around the camera, not a plane.
   * @param position - 2D global point to cast through (e.g. `event.global`).
   * @param out - ray the result is written into. Defaults to a new `Ray`.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @example
   * ```ts
   * view3d.on('pointermove', (e) => {
   *   const ray = view3d.screenToRay(e.global);
   *   const hit = ray.intersectPlane(ground, cursorPos); // Vector3 | null
   * });
   * ```
   * @see {@link View3D#screenToWorld} For going straight to a point on a plane or at a distance.
   */
  public screenToRay(position: PointData, out: Ray = new Ray(), skipUpdate = false): Ray {
    const camera = this._camera;
    const width = this._width;
    const height = this._height;
    const { x: vx, y: vy, width: vw, height: vh } = camera.viewport;
    const localW = vw * width;
    const localH = vh * height;

    // A zero-area view or camera viewport has no defined mapping — without this guard the
    // NDC divisions below would produce a silently-NaN ray (and non-null NaN plane hits).
    if (!(localW > 0) || !(localH > 0)) {
      warnOnce('View3D.screenToRay:degenerate', 'View3D.screenToRay: view size or camera viewport has zero area.');
      out.origin.set(0);
      out.direction.set(0);

      return out;
    }

    // pixi global → View3D-local 2D → camera-viewport NDC (y flipped back to y-up).
    this.getGlobalTransform(_screenMatrix2D, skipUpdate).applyInverse(position, _screenPoint);
    const ndcX = ((_screenPoint.x - (vx - this._anchor.x) * width) / localW) * 2 - 1;
    const ndcY = 1 - ((_screenPoint.y - (vy - this._anchor.y) * height) / localH) * 2;

    // Unproject the near-plane point (GL-style NDC, near at z = -1) into camera space.
    camera.computeProjection(localW / localH, _projMatrix);
    _projMatrix.getInverse(_projMatrix);
    _screenVec.set(ndcX, ndcY, -1).applyMatrix4(_projMatrix);

    camera.getGlobalTransform(_camMatrix, skipUpdate);

    if (camera.mode === 'perspective') {
      // Origin at the camera, direction through the unprojected near-plane point.
      _camMatrix.extractPosition(out.origin);
      _screenVec.applyAffineMatrix4(_camMatrix);
      out.direction.copyFrom(_screenVec).subtract(out.origin).normalize();
    } else {
      // Parallel rays: origin slides back to the camera plane (z = 0) so `at(t)` measures
      // from the camera, matching the perspective origin convention.
      _screenVec.z = 0;
      _screenVec.applyAffineMatrix4(_camMatrix, out.origin);
      out.direction.set(0, 0, -1).transformDirection(_camMatrix);
    }

    return out;
  }

  /**
   * Converts a 2D global point (e.g. `event.global`) to the 3D world-space point a given
   * distance along the pick ray
   *
   * A 2D point alone is depth-ambiguous — it maps to a whole
   * {@link View3D#screenToRay | ray} — so `distance` resolves the depth: the result is the
   * point that many world units along the ray, measured from the camera.
   * @param position - 2D global point to convert.
   * @param distance - distance along the pick ray, in world units from the camera.
   * @param out - point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @returns The world-space point `distance` units along the pick ray
   * @example
   * ```ts
   * // Place a marker 10 units into the scene under the pointer:
   * marker.position.copyFrom(view3d.screenToWorld(e.global, 10));
   * ```
   * @see {@link View3D#worldToScreen} For the reverse direction.
   */
  public screenToWorld(position: PointData, distance: number, out?: Vector3, skipUpdate?: boolean): Vector3;
  /**
   * Converts a 2D global point (e.g. `event.global`) to the 3D world-space point where the
   * pick ray hits a plane — the classic pointer-to-ground pick
   *
   * A 2D point alone is depth-ambiguous — it maps to a whole
   * {@link View3D#screenToRay | ray} — so `plane` resolves the depth: the result is the
   * point where the ray hits the plane, or `null` when it misses (pointing away from, or
   * parallel to, the plane).
   * @param position - 2D global point to convert.
   * @param plane - world-space plane to intersect.
   * @param out - point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @returns The world-space intersection point, or `null` when the ray misses the plane
   * @example
   * ```ts
   * const ground = new Plane(new Vector3(0, 1, 0), 0); // y = 0
   *
   * view3d.on('pointertap', (e) => {
   *   const hit = view3d.screenToWorld(e.global, ground);
   *   if (hit) tree.position.copyFrom(hit);
   * });
   * ```
   * @see {@link View3D#worldToScreen} For the reverse direction.
   */
  public screenToWorld(position: PointData, plane: Plane, out?: Vector3, skipUpdate?: boolean): Vector3 | null;
  /**
   * Implementation of the overloads above
   * @param position - 2D global point to convert.
   * @param target - Distance along the ray, or the world-space plane to intersect.
   * @param out - Point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached transforms.
   * @returns The world-space point, or `null` when the ray misses the plane
   */
  public screenToWorld(position: PointData, target: number | Plane, out?: Vector3, skipUpdate = false): Vector3 | null {
    const ray = this.screenToRay(position, _screenRay, skipUpdate);

    return typeof target === 'number' ? ray.at(target, out) : ray.intersectPlane(target, out);
  }

  /**
   * Selected tone-mapping curve
   *
   * Materials with `toneMapped = true` get the matching shader bit injected at compile
   * time.
   *
   * Setting at runtime invalidates the cached shaders for every Mesh3D in
   * this View — the next frame recompiles each material with the new
   * curve. Subsequent toggles between previously-seen modes are free
   * (variants stay in the shader cache). Intended for occasional changes,
   * not per-frame.
   * @example
   * ```ts
   * view.toneMapping = 'reinhard'; // recompiles materials once
   * view.toneMapping = 'none';     // do your own tone-mapping in post
   * ```
   * @see {@link ToneMapping} For the available curves.
   * @see {@link View3D#exposure} For the pre-curve radiance multiplier.
   */
  public get toneMapping(): ToneMapping {
    return this._toneMapping;
  }

  /**
   * Sets the tone-mapping curve, invalidating cached material shaders when it changes
   * @param value - Curve applied to materials with `toneMapped = true`.
   */
  public set toneMapping(value: ToneMapping) {
    if (this._toneMapping === value) return;
    this._toneMapping = value;
    this._toneMappingBit = TONE_MAPPING_BITS[value];
    this._invalidateMaterialShaders();
  }

  /**
   * Shadow edge-filtering kernel for shadows this View samples — `'hard'`, `'pcf'`
   * (default), or `'pcf-high'`
   *
   * Setting it recompiles each material in this View on the next frame (the kernel is
   * baked into the shadow sampler). Subsequent toggles between previously-seen filters
   * are free (variants stay in the shader cache). Intended for occasional changes, not
   * per-frame.
   * @see {@link ShadowFilter} For the quality/cost tiers.
   */
  public get shadowFilter(): ShadowFilter {
    return this._shadowFilter;
  }

  /**
   * Sets the shadow-filtering kernel, invalidating cached material shaders when it changes
   * @param value - Edge-filtering kernel for the shadows this View samples.
   */
  public set shadowFilter(value: ShadowFilter) {
    if (this._shadowFilter === value) return;
    this._shadowFilter = value;
    this._invalidateMaterialShaders();
  }

  /**
   * Distance fog; `null` disables fog entirely (no fog code in any material shader)
   *
   * Assigning a {@link Fog} stores the reference directly — mutating its
   * `near` / `far` / `density` / `color` after assignment is a free uniform update, no
   * recompile.
   *
   * **`type` cannot be changed in place** — it's `readonly` on the
   * {@link Fog} interface for that reason. To switch curves, assign a
   * new fog object through this setter (e.g. `view3d.fog = { type: 'exp2',
   * density: 0.05, ... }`); the setter detects the new bit identity and
   * invalidates every cached material shader so the variant gets rebuilt
   * on the next frame. Subsequent toggles between previously-seen
   * variants are free (cache hit).
   * @example
   * ```ts
   * view.fog = { type: 'linear', color: 0xadb2ba, near: 30, far: 55 };
   * view.fog.far = 80; // free per-frame tweak
   * view.fog = { type: 'exp2', color: 0xadb2ba, density: 0.05 }; // switch curve
   * view.fog = null;   // disable
   * ```
   * @see {@link Fog} For the configuration object and defaults.
   */
  public get fog(): Fog | null {
    return this._fog;
  }

  /**
   * Sets the fog configuration, invalidating cached material shaders when the curve type changes
   * @param value - Fog settings, stored by reference, or `null` to disable fog.
   */
  public set fog(value: Fog | null) {
    if (this._fog === value) return;
    this._fog = value;
    const nextBit = value ? FOG_BITS[value.type ?? 'linear'] : null;
    if (nextBit !== this._fogBit) {
      this._fogBit = nextBit;
      this._invalidateMaterialShaders();
    }
  }

  /**
   * Passes and post effects added to this view's pipeline
   *
   * One list for both altitudes: a {@link MeshPass} that redraws opted-in meshes at its
   * declared stage, a {@link PostEffect} that filters the finished frame, or any other
   * {@link Pass3D}. Each item knows where it runs, so array order only matters between post
   * effects, where it is the chain order.
   *
   * Assignment is the structural lever and is a transaction: the graph is rebuilt on the next
   * render, and in-place array mutation is not tracked. An item's `enabled` flag also rebuilds
   * the graph, so it suits a settings toggle; per-frame control belongs to each item's own
   * properties, which are plain uniform writes. Composite mode is derived: a view with an
   * enabled post effect renders its scene via a transient, anything else keeps the
   * direct-to-screen fast path (see {@link createDefaultGraph3D}). Items are user-owned:
   * reassignment never destroys them, and one configured instance may be shared across views.
   * @example
   * ```ts
   * view.passes = [new OutlinePass({ width: 0.05 }), new SsaoEffect()];
   * view.passes[1].enabled = false; // per-item toggle (rebuilds the graph)
   * view.passes = [];               // back to the plain pipeline
   * ```
   */
  public get passes(): readonly Pass3D[] {
    return this._passes;
  }

  /**
   * Sets the pass list (`null` clears it), tearing down the compiled graph so the next render rebuilds it
   * @param value - Passes and post effects to run; the array is copied, the items are not.
   */
  public set passes(value: readonly Pass3D[] | null) {
    this._passes = value ? value.slice() : [];
    if (this._passesInitialized) this._teardownGraphForRebuild();
  }

  /** Enabled-flag bitmask for the rebuild check (positions beyond 32 alias — harmless, they just re-key) */
  private _computePassesKey(): number {
    let key = 0;
    for (let i = 0; i < this._passes.length; i++) {
      if (this._passes[i].enabled) key |= 1 << (i & 31);
    }
    return key;
  }

  /**
   * Tear the compiled graph down so the next render rebuilds it
   *
   * Rebuilding re-derives the pass list and composite mode; the material-shader invalidation
   * sweep re-keys every renderable against the new pass instances.
   *
   * The passes give their GPU state back through `unload` first, while this View's global
   * bind group is still alive to be re-pointed: releasing the shadow map moves the shadow
   * slot to the empty depth texture and re-records every bundle that baked the old map before
   * the target dies. The replacement shadow pass starts a fresh target generation, so every
   * light is asked to redraw its layers into the new map whatever its update cadence says.
   */
  private _teardownGraphForRebuild(): void {
    this._graph.unload();
    for (let i = 0; i < this.lights.length; i++) this.lights[i].refreshShadows();
    this._graph.destroy();
    this._passesInitialized = false;
    this._invalidateMaterialShaders();
  }

  /**
   * Environmental fill source for this View
   *
   *   - `CubeTexture` — IBL prefiltered specular + diffuse irradiance.
   *   - {@link Hemisphere} — sky/ground gradient fill (cheap, no textures).
   *   - `null` — no environmental fill. PBR materials compile without their environment
   *     block, and rendering the view does not trigger BRDF lookup or prefiltered-cube generation.
   *
   * Mutually exclusive — only one env-source variant is compiled into each
   * material shader. Swapping between kinds (e.g. hemisphere → cube once
   * the cubemap loads) invalidates cached material shaders so the right
   * variant rebuilds. Swapping between two `CubeTexture`s, or mutating
   * fields on a hemisphere object, is a free uniform update — no recompile.
   * @example
   * ```ts
   * // Cheap gradient fill (great default, mobile-friendly):
   * view.environment = { skyColor: 0x88ccff, groundColor: 0x553311 };
   *
   * // Upgrade to IBL once the cube map has loaded:
   * view.environment = await Assets.load<CubeTexture>('studio.cubemap');
   * ```
   * @see {@link Hemisphere} For the gradient-fill option.
   */
  public get environment(): CubeTexture | Hemisphere | null {
    return this._environment;
  }

  /**
   * Sets the environmental fill source, invalidating cached material shaders when the source kind changes
   * @param value - Cube map for IBL, a hemisphere gradient, or `null` for no fill.
   */
  public set environment(value: CubeTexture | Hemisphere | null) {
    if (this._environment === value) return;
    this._environment = value;
    const nextBit =
      value === null ? envSourceDefaultBit : value instanceof CubeTexture ? envSourceCubeBit : envSourceHemisphereBit;
    if (nextBit !== this._envBit) {
      this._envBit = nextBit;
      this._invalidateMaterialShaders();
    }
  }

  /**
   * Enables shadow sampling after the first packed light starts casting
   * @internal
   */
  public _syncShadowSampling(): void {
    if (this._hasShadows) return;

    const lights = this.lights;
    let packedLightCount = 0;

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];

      if (!light._worldVisible || light.type === 'ambient') continue;
      if (packedLightCount >= MAX_LIGHTS) return;

      packedLightCount++;

      if (!light.canCastShadow) continue;

      this._hasShadows = true;
      this._invalidateMaterialShaders();

      return;
    }
  }

  /**
   * Mark every renderable in this view as needing a shader rebuild on the next frame
   *
   * Used when a per-View setting that participates in the shader cache key
   * (e.g. `toneMapping`) changes.
   *
   * Walks `meshBatches` so both scene-graph Mesh3Ds (in meshBatches[0]) and
   * user-batch items (meshBatches[1..]) get invalidated. User batches gate
   * processing on `_dirtyIndices`, so we also push every index in.
   */
  private _invalidateMaterialShaders(): void {
    for (let b = 0; b < this._meshBatches.length; b++) {
      const batch = this._meshBatches[b];
      const items = batch.items;
      for (let i = 0; i < items.length; i++) {
        // The scene batch aliases the StableList backing array, where a
        // removed mesh leaves a persistent null hole until the slot is
        // reused. User batches are dense — the guard never fires there.
        const item = items[i];
        if (!item) continue;

        // `ensureMaterial` re-runs off `_batchDirty` (+ the dirty-indices
        // refill below for user batches). Material data is untouched — the
        // struct is construction-pinned — so no store re-upload is queued.
        item._batchDirty = true;
      }
      // User batches gate processing on `_dirtyIndices`. Reset and refill
      // exactly so any prior partial-dirty entries are replaced rather
      // than appended past the array end.
      if (b > 0 && batch._dirtyIndices) {
        for (let i = 0; i < items.length; i++) batch._dirtyIndices[i] = i;
        batch._dirtyCount = items.length;
      }
    }
  }

  /**
   * pixi.js `ViewContainer` hook deriving the View's 2D bounds from
   * {@link View3D#width | width}, {@link View3D#height | height} and
   * {@link View3D#anchor | anchor} so it participates
   * correctly in 2D layout and culling
   * @internal
   */
  protected updateBounds(): void {
    const bounds = this._bounds;

    const width = this._width;
    const height = this._height;
    const { x, y } = this._anchor;

    bounds.minX = -x * width;
    bounds.maxX = bounds.minX + width;

    bounds.minY = -y * height;
    bounds.maxY = bounds.minY + height;
  }

  /**
   * Recursively registers `child` and its subtree with this View: assigns scene depth,
   * queues a transform update, and indexes any Mesh3D / BatchedMesh3D / Light it finds
   *
   * Invoked by `Container3D.addChild`, which omits `ancestorPickState` — the entry point
   * derives it with one walk up the new parent chain, and the recursion threads it down.
   * @param child - Node to register, along with its subtree.
   * @param ancestorPickState - Whether an ancestor blocks or covers picking; derived from the parent chain when omitted.
   * @internal
   */
  public _attach(child: Container3D, ancestorPickState: AncestorPickState = getAncestorPickState(child)) {
    child._updateTick = -1;

    child._view3d = this;

    if (child === this.root) {
      child._relativeSceneDepth = 0;
    } else {
      child._relativeSceneDepth = child.parent!._relativeSceneDepth + 1;
    }

    child.didChange = true;
    this._onChildUpdate(child);

    // Thread the registration state down: a barrier ('none' or `interactiveChildren: false`) blocks
    // everything below it (a deeper interactive node cannot lift the block — resolve prunes on the
    // full chain), an interactive node covers its subtree, anything else passes the state through.
    const mode = child._eventMode;
    const childPickState: AncestorPickState =
      mode === 'none' || !child._interactiveChildren || ancestorPickState === PICK_BLOCKED
        ? PICK_BLOCKED
        : mode === 'static' || mode === 'dynamic'
          ? PICK_COVERED
          : ancestorPickState;

    const children = child.children;

    for (let i = 0; i < children.length; i++) {
      this._attach(children[i], childPickState);
    }

    if (child instanceof BatchedMesh3D) {
      this._meshBatches.push(child.batch);
      this._meshBatchesDirtyId++;
    } else if (child instanceof Mesh3D) {
      this._meshSlots.add(child);
      this.meshes.add(child);

      if (child.skeleton) {
        this._skinnedMeshes.add(child);
      }

      if (child.morph) {
        this._morphedMeshes.add(child);
      }
      // Force a shader-cache lookup on the next frame; the mesh may carry a
      // shader compiled against another View whose tone-mapping / shadow
      // settings differ from this one's.
      child._batchDirty = true;
    } else if (child instanceof Light) {
      this.lights.push(child);
    }

    // Register nodes carried in by an already-assembled subtree: below no barrier, pick candidates
    // by their own mode (eventMode static/dynamic/auto), plus volume-bearing 'passive' nodes under
    // an interactive ancestor — a hit on those resolves to that ancestor. `eventMode` / `hitVolume`
    // changes on attached nodes reach the boundary straight from the setters instead.
    if (
      ancestorPickState !== PICK_BLOCKED &&
      (child._isPickCandidate() || (ancestorPickState === PICK_COVERED && mode !== 'none' && child._hasPickVolume()))
    ) {
      this.events._addInteractive(child);
    }

    // Carried-in explicit volumes clip their descendants; the boundary gates all per-pick clip work
    // on this count. The `hitVolume` setter keeps it in sync while attached.
    if (child._hitVolumeInput !== null) this.events._clipVolumeCount++;
  }

  /**
   * Inverse of `View3D._attach`: recursively unregisters `child` and its subtree,
   * releasing mesh slots, batches, and light entries
   *
   * Invoked by `Container3D.removeChild`.
   * @param child - Node to unregister, along with its subtree.
   * @internal
   */
  public _detach(child: Container3D) {
    const children = child.children;

    for (let i = 0; i < children.length; i++) {
      this._detach(children[i]);
    }

    if (child instanceof BatchedMesh3D) {
      const idx = this._meshBatches.indexOf(child.batch);
      if (idx > 0) {
        this._meshBatches.splice(idx, 1);
        this._meshBatchesDirtyId++;
      }
    } else if (child instanceof Mesh3D) {
      const slotIndex = this._meshSlots.getIndex(child);
      this._sceneBatch.setItemActive(slotIndex, 0);

      this._meshSlots.remove(child);
      this.meshes.remove(child);
      this._sceneBatch.storeBuffer.remove(child);
      // Reset the render side's visibility memory along with the row it described, so a
      // re-attach behaves exactly like a first attach: a mesh that comes back hidden reads
      // as a flip, which re-emits (and thereby mints) its store row — a pass member must
      // always have a row, or its id feeds the instance buffer as -1.
      child._lastWorldVisible = 1;
      // Same reason: the row goes with the store, so the bone-pit watermark that described it
      // must not survive to suppress the re-emit on re-attach.
      child._lastBonePitIndex = -1;

      if (child.skeleton) {
        this._skinnedMeshes.remove(child);
      }

      if (child.morph) {
        this._morphedMeshes.remove(child);
        // Release the weight slot in the renderer-shared morph store — scene
        // membership is the slot's lifetime. The morph carries the store
        // reference, so no renderer context is needed here.
        child.morph._store?.freeSlot(child.morph);
      }
    } else if (child instanceof Light) {
      const index = this.lights.indexOf(child);

      if (index > -1) {
        this.lights.splice(index, 1);
      }

      // The cached per-cascade shadow bind groups bind THIS view's bone-pit
      // buffer (slot 3, built in ShadowRenderPassBase.getShadowGPUData /
      // ShadowRenderPassGpu._cascadeSlot). Drop them on detach so they're rebuilt
      // against whichever view renders the light next, and never dangle after
      // this view frees its bone pit on destroy.
      child._releaseShadowState();
    }

    // Mirror of the registration in `_attach`, driven by the node's list slot so implicit
    // ('passive' under an interactive ancestor) entries unwind too. Pick caches are cleared silently
    // either way: dispatching `pointerout` as a side effect of `removeChild` would be surprising.
    if (child._pickIndex !== -1) {
      this.events._removeInteractive(child);
    } else {
      this.events._clearPickState(child);
    }

    if (child._hitVolumeInput !== null) this.events._clipVolumeCount--;

    child._view3d = null;
  }

  /**
   * Enqueues `child` into the per-depth update bucket consumed by the next transform pass
   *
   * Buckets are keyed by `_relativeSceneDepth` so ancestors are visited before
   * descendants.
   * @param child - Node whose transform needs updating.
   * @internal
   */
  public _onChildUpdate(child: Container3D) {
    let childrenToUpdate = this._childrenToUpdate[child._relativeSceneDepth];

    if (!childrenToUpdate) {
      childrenToUpdate = this._childrenToUpdate[child._relativeSceneDepth] = {
        index: 0,
        list: [],
      };
    }

    childrenToUpdate.list[childrenToUpdate.index++] = child;
  }

  /**
   * pixi.js update hook — forwards to `ViewContainer.onViewUpdate`
   * @internal
   */
  public _onUpdate(): void {
    this.onViewUpdate();
  }

  /**
   * Rebuild every batch's draw commands next frame
   *
   * The blunt end of invalidation — normally a change dirties only the batch and pass it
   * touches. Reserve this for things the whole View binds against: a shared store
   * (materials, bones, morphs, geometry atlas) growing and reallocating out from under
   * every recorded command.
   * @internal
   */
  public _invalidateDrawCaches(): void {
    for (let b = 0; b < this._meshBatches.length; b++) this._meshBatches[b].invalidateDrawCaches();
  }

  /**
   * Re-records every batch's WebGPU bundles next frame, leaving the draw commands alone
   *
   * Cheaper than {@link View3D#_invalidateDrawCaches} — use it when only state a bundle
   * bakes in changed, such as the shadow-map binding moving to a different texture.
   * @internal
   */
  public _invalidateBundleCaches(): void {
    for (let b = 0; b < this._meshBatches.length; b++) this._meshBatches[b].invalidateBundleCaches();
  }

  /**
   * Not available on `View3D`
   *
   * The View has no child list of its own — parent 3D objects under
   * {@link View3D#root | root} with `view.root.addChild()`.
   * @throws {Error} Always.
   * @ignore
   */
  public override addChild<U extends ContainerChild[]>(..._children: U): U[0] {
    throw new Error('View3D.addChild() is not available. Use view.root.addChild() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.removeChild()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override removeChild<U extends ContainerChild[]>(..._children: U): U[0] {
    throw new Error('View3D.removeChild() is not available. Use view.root.removeChild() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.removeChildren()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override removeChildren(_beginIndex?: number, _endIndex?: number): ContainerChild[] {
    throw new Error('View3D.removeChildren() is not available. Use view.root.removeChildren() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.removeChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override removeChildAt<U extends ContainerChild>(_index: number): U {
    throw new Error('View3D.removeChildAt() is not available. Use view.root.removeChildAt() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.getChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override getChildAt<U extends ContainerChild>(_index: number): U {
    throw new Error('View3D.getChildAt() is not available. Use view.root.getChildAt() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.setChildIndex()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override setChildIndex(_child: ContainerChild, _index: number): void {
    throw new Error('View3D.setChildIndex() is not available. Use view.root.setChildIndex() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.getChildIndex()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override getChildIndex(_child: ContainerChild): number {
    throw new Error('View3D.getChildIndex() is not available. Use view.root.getChildIndex() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.addChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override addChildAt<U extends ContainerChild>(_child: U, _index: number): U {
    throw new Error('View3D.addChildAt() is not available. Use view.root.addChildAt() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.swapChildren()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override swapChildren<U extends ContainerChild>(_child: U, _child2: U): void {
    throw new Error('View3D.swapChildren() is not available. Use view.root.swapChildren() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.reparentChild()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override reparentChild<U extends ContainerChild[]>(..._child: U): U[0] {
    throw new Error('View3D.reparentChild() is not available. Use view.root.reparentChild() instead.');
  }

  /**
   * Not available on `View3D` — use `view.root.reparentChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override reparentChildAt<U extends ContainerChild>(_child: U, _index: number): U {
    throw new Error('View3D.reparentChildAt() is not available. Use view.root.reparentChildAt() instead.');
  }

  /**
   * Builds the render graph on first call (via the user-supplied
   * {@link View3DOptions#graph} builder or {@link createDefaultGraph3D}) and
   * derives the bit lookup + dirty-hook bitmask from `graph.passes`
   *
   * Called by `View3DPipeGpu.execute` / `View3DPipeGl.execute`.
   * @param renderer - Renderer the graph is built for.
   * @internal
   */
  public _ensureInitialized(renderer: WebGLRenderer | WebGPURenderer): void {
    // An `enabled` flip changes the compiled wiring (which stages have passes,
    // composite derivation, ping-pong slots, presenter election), so a mismatch
    // against the key the graph was built with tears it down for the rebuild
    // below. O(passes) per frame; compiled shaders and pooled transients are reused.
    if (this._passesInitialized && this._passes.length > 0 && this._passesEnabledKey !== this._computePassesKey()) {
      this._teardownGraphForRebuild();
    }

    if (this._passesInitialized) return;

    // User callback wins; otherwise the standard factory builds the default
    // graph. Both get the same options, so a builder that starts from
    // `createDefaultGraph3D` keeps `passes` and `composite` working. The
    // factory pre-compiles; user callbacks may forget, so we recompile here
    // unconditionally (idempotent, cheap).
    const graphOptions: DefaultGraph3DOptions = { composite: this._composite, passes: this._passes };
    this._graph = this._buildGraph
      ? this._buildGraph(renderer, graphOptions)
      : createDefaultGraph3D(renderer, graphOptions).graph;
    this._graph.compile();
    this._passesEnabledKey = this._computePassesKey();

    // Per-pass bit lookup consumed by `updateView3DScene`'s dirty-hook dispatch.
    // Materials and dispatch loops key into pass bits via this view, not the graph.
    for (const k in this.passByBit) delete this.passByBit[k];
    this._dirtyHookBits = 0;
    for (const graphPass of this._graph.passes) {
      const pass = graphPass as RenderPass;
      // Passes that take no meshes (fullscreen effects, graph operations) own no draw list.
      if (pass.bit === RenderPassBit.NONE) continue;
      // Two cameras may share a name. One pass owns the list; the others just draw it.
      const owner = this.passByBit[pass.bit];
      if (pass.camera) {
        if (owner) continue;
      } else if (owner && !owner.camera) {
        throw new Error(`Render pass "${pass.name}" is used twice in this view; give the second one a camera.`);
      }
      // The view camera owns the name even if a texture camera's pass was declared first.
      this.passByBit[pass.bit] = pass;
      this._dirtyHookBits |= pass.bit;
    }

    // A descriptor is only used on the pass that owns that name.
    for (const graphPass of this._graph.passes) {
      const pass = graphPass as RenderPass;
      if (pass.bit === RenderPassBit.NONE || !pass.descriptor) continue;
      if (this.passByBit[pass.bit] === pass) continue;
      throw new Error(
        `Render pass "${pass.name}" has a descriptor, but another pass owns that name. ` +
          'Put the descriptor there, or give this pass its own name.',
      );
    }

    this._passesInitialized = true;
  }

  /**
   * Give this View's GPU memory back now — for a scene that is out of rotation for a while
   * but will be shown again. Everything freed here is rebuilt lazily by the next frame that
   * renders the View: the recorded draw programs and WebGPU bundles together with the
   * captures those builds took on material textures and geometry buffers, the shadow map,
   * the per-light cascade state, the global bind groups, and the GPU copies of every buffer
   * the View owns (mesh stores, bone pit, light/shadow lists, instance and indirect-draw
   * args).
   *
   * CPU state is untouched — the scene graph, the store contents, and every backing typed
   * array stay exactly as they are, which is what makes the revival free of any re-authoring
   * (the same contract as a 2D texture keeping its source image across `unload`).
   *
   * Not scoped to one renderer: `Buffer.unload()` frees a buffer's GPU copy for *every*
   * renderer, so a View shown by two renderers gives back both and each re-uploads on its
   * next frame — a one-frame hitch, not a fault. For the same reason every renderer's global
   * data on this View goes, not just the calling one's: a surviving WebGPU bind group would
   * keep serving the native bind group it cached over the freed buffers.
   *
   * pixi's renderer GC calls this directly for a View that has been out of every rendered
   * tree for `gcMaxUnusedTime`; a View still under a rendered render group is refreshed on
   * every sweep, visible or not (see `View3DGCRegistry`). Idempotent: every step is a no-op
   * on state that is already given back, including after {@link View3D#destroy}.
   * @example
   * ```ts
   * view.visible = false; // hiding alone never collects: an attached View is refreshed every sweep
   * view.unload(); // hand the GPU memory back; the next render rebuilds
   * ```
   * @see {@link View3D.destroy} For permanent teardown.
   */
  public override unload(): void {
    // Batches first: dropping each build drops the captures it took on material textures
    // and geometry buffers (they return to pixi's normal collection rules) and marks the
    // caches that bind everything freed below as stale.
    for (let i = 0; i < this._meshBatches.length; i++) this._meshBatches[i].unload();

    // Per-light shadow state: the cascade bind groups bind this View's bone-pit buffer and
    // own exempt cascade UBOs. A fresh set is built on revival; the refresh request covers a
    // light whose update cadence would otherwise let it skip the frame that has to redraw
    // its layers into the new map.
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      if (!light._gpuShadowData) continue;
      light._releaseShadowState();
      light.refreshShadows();
    }

    // Pass-owned state, the shadow map above all: its release re-points this View's shadow
    // slot at the empty depth texture while the global bind group is still alive.
    if (this._passesInitialized) this._graph.unload();

    this._bonePit.unload();

    // pixi's half: emits `unload`, which each renderer's GC hash answers by destroying the
    // global data it keeps on this View (bind group, then uniform buffer) and clearing its slot
    // and entry; destroys any per-renderer data left, resets `_gpuData`, and marks the View for
    // re-render. The next frame mints fresh global data seeded with the placeholders.
    super.unload();
  }

  /**
   * Tears down this View and its exclusively-owned GPU resources
   *
   * 3D-owned GPU resources are always released regardless of `options`: the
   * global bind groups, the render graph (its render-target cache and owned
   * passes), the bone-matrix arena, and the scene batch (`meshBatches[0]`).
   * User batches (`meshBatches[1..]`) are owned by their {@link BatchedMesh3D}
   * and are not destroyed here.
   *
   * The 3D scene under {@link View3D#root | root} is not a pixi child, so
   * pixi's `Container.destroy` never reaches it. It is destroyed only when the
   * `children` flag is set, in which case `options` (including `geometry` /
   * `material` / `texture`) is forwarded into `root.destroy`. Without the flag
   * the subtree is not destroyed, but it is still DETACHED from `root` (and thus
   * from the freed scene batch): the nodes stay alive for a caller holding
   * references, just unparented, so they hold no stale batch slot.
   *
   * Idempotent: a second call is a no-op via the inherited `destroyed` guard.
   * @param options - teardown options; see {@link Destroy3DOptions}. A boolean
   *   stands in for every flag. Defaults to destroying nothing shared.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    // GPU state first: every global bind group dies (through the `unload` event each
    // renderer's GC hash answers) before the light, shadow and bone buffers it binds are
    // destroyed below, and the recorded builds let go of what they captured.
    this.unload();

    // Cascade into the 3D subtree: root.destroy -> removeChildren ->
    // _detach reads live mesh/light slots and unwinds the scene batch's
    // per-pass views, so it must run before _sceneBatch is destroyed below.
    // Without the `children` flag the subtree is left intact for a caller still
    // holding references, but it must still be DETACHED from the (always freed)
    // scene batch — otherwise a retained mesh keeps a stale `_storeIndex` /
    // `view3d` pointing at destroyed GPU state. `removeChildren` runs the same
    // recursive `_detach` while the batch is live.
    if (resolveDestroy3DFlag(options, 'children')) {
      this.root.destroy(options);
    } else {
      this.root.removeChildren(0, this.root.children.length);
      // root is attached to this view out-of-band (not a pixi child), so its
      // back-ref isn't cleared by the steps above; drop it so a retained root
      // doesn't write into this destroyed view.
      this.root._view3d = null;
    }

    // The graph is built lazily on first render; only present once initialised.
    if (this._passesInitialized && this._graph) this._graph.destroy();

    this._bonePit.destroy();

    // The morph store outlives this view (it's renderer-shared), so weight
    // slots held by still-attached meshes must be released here — `_detach`
    // only runs for meshes removed before the destroy.
    const morphedMeshes = this._morphedMeshes.items;
    for (let i = 0; i < morphedMeshes.length; i++) {
      const morph = morphedMeshes[i].morph!;
      morph._store?.freeSlot(morph);
    }

    // Owned scene batch. Sibling user batches (meshBatches[1..]) belong to
    // their BatchedMesh3D and are intentionally left alone.
    this._sceneBatch.destroy();

    // Drop CPU references so destroyed (or detached) meshes/lights aren't pinned.
    this._meshSlots.items.length = 0;
    this._meshSlots.count = 0;
    this.meshes.clear();
    this._skinnedMeshes.clear();
    this._morphedMeshes.clear();
    this.lights.length = 0;

    for (const depth in this._childrenToUpdate) delete this._childrenToUpdate[depth];

    // Release the boundary's retained node references (pointer records, pick
    // list, click histories). Its dispatch listeners live on this View's own
    // emitter and die with it.
    this.events.destroy();

    for (const k in this.passByBit) delete this.passByBit[k];
    this._dirtyHookBits = 0;

    this._meshBatches.length = 0;

    // `ViewContainer.destroy` runs `this.unload()` once more: every step in it is a no-op on
    // the state freed above, and the `unload` event finds no GC hash still holding this View.
    // Then the Container chain. `children` is empty (allowChildren = false; root is attached
    // out-of-band), so Container's guarded removeChildren is skipped and the throwing override
    // is never hit.
    super.destroy(options);
  }
}
