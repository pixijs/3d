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
     * Declare added members here and merge their implementation onto the class with pixi.js's
     * `extensions.mixin(View3D, myMixin)`, the pattern pixi's 2D `Container` uses. The interaction
     * members `containsPoint`, `cursor`, `hitArea` and `raycast` arrive this way.
     *
     * They reach the class through the `View3D` interface declared beside it, which repeats the
     * class's type parameters because TypeScript only merges declarations whose parameters match.
     */
    interface View3D {}
    /** Augmentation hook for constructor options mixed into {@link View3DOptions} */
    interface View3DOptions {}
  }
}

/**
 * Most lights a view draws at once
 *
 * Ambient lights don't count. Past the limit, visible lights are skipped in the order of
 * {@link View3D#lights}, so the lights added last are the ones left out. It can't exceed 32:
 * `binLightTiles` in `LightTiles.ts` makes light `i` bit `i` of a 32-bit mask.
 * @category scene
 * @advanced
 */
export const MAX_LIGHTS = 32;

/**
 * Floats per light slot in `LightDataList`: four `vec4`s
 * @internal
 */
export const FLOATS_PER_LIGHT = 16;

/**
 * Tone mapping that materials apply as the last step of their shader; see {@link View3D#toneMapping}
 *
 * The curve and the sRGB encode for the screen are separate steps:
 * - `'aces'`, `'reinhard'` and `'uncharted2'`: a filmic curve that rolls off bright light, then the
 *   sRGB encode.
 * - `'none'`: the sRGB encode alone. The scene shows as lit, and anything brighter than 1 clips.
 *   This is what most people mean by "no tone mapping".
 * - `'custom'`: neither. Materials output raw linear light, for a post effect that does its own
 *   tone mapping and encoding.
 *
 * Materials with `toneMapped` off skip it.
 * @example
 * ```ts
 * const view = new View3D({ width, height, toneMapping: 'reinhard' });
 *
 * view.toneMapping = 'aces';
 * ```
 * @see {@link View3D#exposure} For the brightness multiplier applied before the curve.
 * @category environment
 * @standard
 */
export type ToneMapping = 'aces' | 'reinhard' | 'uncharted2' | 'none' | 'custom';

/**
 * How a view or a {@link BatchedMesh3D} skips what's outside the camera's view, decided for each
 * batch every frame
 *
 * A view's mode ({@link View3DOptions.cull}) covers its meshes. A `BatchedMesh3D` has its own,
 * {@link BatchedMesh3D.cull}, for its instances.
 *
 * - `'off'`: no culling; every instance draws.
 * - `'cpu'`: cull on the CPU, then draw what's left.
 * - `'gpu'`: cull in a compute shader, which suits large instanced batches. WebGL has no compute
 *   shaders, so it culls on the CPU there.
 * - `'auto'`: the default. Small batches skip culling, since drawing everything costs less than
 *   testing it. Larger ones cull on the GPU under WebGPU and on the CPU under WebGL.
 *
 * Culling only changes what gets drawn, never what you see. Shadow maps are culled too.
 * @example
 * ```ts
 * const view = new View3D({ cull: 'gpu' });
 * ```
 * @see {@link View3D#cull} For the mode a view was built with.
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
 * How distance fog thickens with depth, the distance in front of the camera
 *
 * - `'linear'`: `smoothstep(near, far, depth)`, from no fog at `near` to full fog at `far`.
 * - `'exponential'`: `1 - exp(-density * depth)`. A soft haze that starts right at the camera.
 * - `'exp2'`: `1 - exp(-(density * depth)²)`. Clear near the camera, then closing in.
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

/** Depth of the near plane after projection: camera projections run from -1 at `near` to 1 at `far` */
const NEAR_PLANE_NDC_Z = -1;

const _screenMatrix2D = new Matrix();
const _screenPoint = new Point();
const _projMatrix = new Matrix4();
const _camMatrix = new Matrix4();
const _screenVec = new Vector3();
const _screenRay = new Ray();

/**
 * Distance fog settings for {@link View3D#fog}
 *
 * Every field is optional. A missing `far` is so far away that linear fog never shows, and a
 * missing `density` is 0, which means no exponential fog.
 *
 * The view keeps the object you assign, so changing its `color`, `near`, `far` or `density` later
 * is free and shows on the next frame. `type` is read-only because a new curve needs new shaders:
 * assign a new object to switch curves.
 *
 * Materials with `fog` turned off, such as a skybox or water that fades itself, ignore it.
 * @example
 * ```ts
 * const haze: Fog = { type: 'linear', color: 0xadb2ba, near: 30, far: 55 };
 *
 * view.fog = haze;
 * haze.far = 80;
 *
 * view.fog = { type: 'exp2', color: 0xadb2ba, density: 0.05 };
 * view.fog = null;
 * ```
 * @see {@link FogType} For the curves.
 * @category environment
 * @standard
 */
export interface Fog {
  /**
   * How the fog thickens with distance; see {@link FogType}
   *
   * Read-only: assign a new object to {@link View3D#fog} to switch curves.
   * @default 'linear'
   * @example
   * ```ts
   * view.fog = { type: 'exp2', density: 0.04 };
   * ```
   */
  readonly type?: FogType;
  /**
   * Fog colour, authored in sRGB like every other colour
   *
   * Exposure and the tone curve apply to the fog as they do to the scene, so distant surfaces end
   * up near this colour on screen rather than exactly on it.
   * @default 0xcccccc
   * @example
   * ```ts
   * view.fog = { color: 'lightsteelblue', near: 20, far: 60 };
   * ```
   */
  color?: ColorSource;
  /**
   * Distance where linear fog starts, in world units; the other curves ignore it
   * @default 0
   * @example
   * ```ts
   * view.fog = { type: 'linear', near: 10, far: 40 };
   * ```
   */
  near?: number;
  /**
   * Distance where linear fog becomes solid, in world units; the other curves ignore it
   * @default 99999999
   * @example
   * ```ts
   * view.fog = { type: 'linear', near: 0, far: 120 };
   * ```
   */
  far?: number;
  /**
   * How quickly exponential fog thickens, where `0` means no fog; linear fog ignores it
   * @default 0
   * @example
   * ```ts
   * view.fog = { type: 'exponential', density: 0.02 };
   * ```
   */
  density?: number;
}

/**
 * Constructor options for {@link View3D}
 *
 * Every field is optional and has a default documented on its member. Pass `width` and
 * `height` to match the drawing surface, like a pixi.js `TilingSprite`.
 *
 * pixi's own container options (`label`, `position`, `alpha`, `parent`, `eventMode`, `cursor`,
 * `hitArea`, the `on*` handlers and the rest) work too. They're applied last, so
 * `eventMode: 'none'` or `'passive'` turns off the view's pointer events, as setting it later
 * would.
 * @example
 * ```ts
 * const view = new View3D({
 *   width: 1280,
 *   height: 720,
 *   anchor: 0.5,
 *   shadowQuality: 'high',
 *   toneMapping: 'aces',
 *   exposure: 1.2,
 *   fog: { type: 'linear', color: 0xadb2ba, near: 30, far: 55 },
 *   environment: { skyColor: 0x88ccff, groundColor: 0x553311 },
 * });
 * ```
 * @see {@link View3D} For changing the settings after construction.
 * @typeParam TRoot - Type of the {@link View3DOptions#root | root} container, carried through to
 * {@link View3D#root}. Inferred from the `root` you pass.
 * @category scene
 * @standard
 */
export interface View3DOptions<TRoot extends Container3D = Container3D>
  extends PixiMixins.View3DOptions, Omit<ViewContainerOptions, 'children' | 'isRenderGroup'> {
  /**
   * Root of the 3D scene; see {@link View3D#root}
   * @default new Container3D()
   * @example
   * ```ts
   * const view = new View3D({ root: new Model3D(source) });
   *
   * view.root.player?.play('Wave');
   * ```
   */
  root?: TRoot;
  /**
   * Camera to draw from, added to {@link View3DOptions#root | root} when it isn't in the scene yet
   * @default new Camera3D()
   * @example
   * ```ts
   * const view = new View3D({ camera: new Camera3D({ fov: 45 }) });
   * ```
   */
  camera?: Camera3D;
  /**
   * Width of the 3D viewport in pixels
   *
   * With {@link View3DOptions#autoResize | autoResize} on, this is only the size reported
   * before the first render.
   * @default 256
   * @example
   * ```ts
   * const view = new View3D({ width: 800, height: 600 });
   * ```
   */
  width?: number;
  /**
   * Height of the 3D viewport in pixels; see {@link View3DOptions#width | width}
   * @default 256
   * @example
   * ```ts
   * const view = new View3D({ width: 800, height: 600 });
   * ```
   */
  height?: number;
  /**
   * Match the renderer's screen size on every render, following it when the canvas resizes;
   * see {@link View3D#autoResize}
   * @default false
   * @example
   * ```ts
   * const view = new View3D({ autoResize: true });
   * ```
   */
  autoResize?: boolean;
  /**
   * Where the view's origin sits, as a fraction of its size; see {@link View3D#anchor}
   * @default 0
   * @example
   * ```ts
   * const view = new View3D({ width: 400, height: 300, anchor: 0.5 });
   * ```
   */
  anchor?: PointData | number;
  /**
   * Size of the shadow maps; see {@link View3D#shadowQuality}
   * @default 'medium'
   * @example
   * ```ts
   * const view = new View3D({ shadowQuality: 'low' });
   * ```
   */
  shadowQuality?: ShadowQuality;
  /**
   * How soft shadow edges are; see {@link View3D#shadowFilter}
   * @default 'pcf'
   * @example
   * ```ts
   * const view = new View3D({ shadowFilter: 'hard' });
   * ```
   */
  shadowFilter?: ShadowFilter;
  /**
   * Light from the surroundings: a cube map, a {@link Hemisphere} gradient, or `null` for none;
   * see {@link View3D#environment}
   * @default null
   * @example
   * ```ts
   * const view = new View3D({ environment: { skyColor: 0x88ccff, groundColor: 0x553311 } });
   * ```
   */
  environment?: CubeTexture | Hemisphere | null;
  /**
   * Drawn behind the scene: a cube map, a {@link Hemisphere} gradient, or `null` for none; see
   * {@link View3D#background}
   * @default null
   * @example
   * ```ts
   * const view = new View3D({ environment: sky, background: sky });
   * ```
   */
  background?: CubeTexture | Hemisphere | null;
  /**
   * Tone mapping curve; see {@link View3D#toneMapping}
   * @default 'aces'
   * @example
   * ```ts
   * const view = new View3D({ toneMapping: 'none' });
   * ```
   */
  toneMapping?: ToneMapping;
  /**
   * Brightness multiplier applied before tone mapping; see {@link View3D#exposure}
   * @default 1.0
   * @example
   * ```ts
   * const view = new View3D({ exposure: 1.4 });
   * ```
   */
  exposure?: number;
  /**
   * Distance fog, left out for none; see {@link View3D#fog}
   * @example
   * ```ts
   * const view = new View3D({ fog: { type: 'linear', color: 0xadb2ba, near: 30, far: 55 } });
   * ```
   */
  fog?: Fog;
  /**
   * How the view culls its meshes outside the camera's view; see {@link CullMode}
   *
   * A {@link BatchedMesh3D} has its own, {@link BatchedMesh3D.cull}. Fixed once the view exists,
   * so pick it here.
   * @default 'auto'
   * @example
   * ```ts
   * const view = new View3D({ cull: 'off' });
   * ```
   */
  cull?: CullMode;
  /**
   * Draw the scene into its own texture, then onto the screen, instead of straight to the screen
   *
   * Any enabled post effect in {@link View3DOptions#passes | passes} turns it on. Set it yourself
   * to alpha-composite an inset over 2D content without an effect. A custom
   * {@link View3DOptions#graph | graph} builder receives it in its options.
   * @default false
   * @example
   * ```ts
   * const inset = new View3D({ width: 320, height: 240, composite: true });
   * ```
   */
  composite?: boolean;
  /**
   * Passes and post effects for this view, the same as assigning {@link View3D#passes} later
   * @example
   * ```ts
   * const view = new View3D({ passes: [new OutlinePass({ width: 0.05 }), new BloomEffect()] });
   * ```
   */
  passes?: readonly Pass3D[];
  /**
   * Builds the render graph for this view
   *
   * Runs on the first render, and again whenever the graph is rebuilt: after
   * {@link View3D#passes} is assigned, or after a pass's `enabled` flag flips. The graph it
   * returns draws every frame until then.
   *
   * Leave it out to use {@link createDefaultGraph3D}. Adding passes to the standard pipeline
   * needs no builder; see {@link View3DOptions#passes}. This callback is for a different
   * pipeline: start from `createDefaultGraph3D` and append, or build a bare {@link RenderGraph}.
   * Forward `options` so `passes` and `composite` keep working.
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
   * @example
   * ```ts
   * const view = View3D.from(source, { light: false, environment: studio });
   * ```
   */
  light?: boolean;
}

// oxlint-disable-next-line pixi3d/require-export-jsdoc, pixi3d/require-member-api-doc, no-unused-vars
export interface View3D<TRoot extends Container3D = Container3D> extends PixiMixins.View3D {}

/**
 * A 3D scene drawn inside pixi's 2D display list
 *
 * A `View3D` is a pixi display object: add it to the stage, then move, mask or filter it like a
 * sprite. Everything 3D goes under its {@link View3D#root | root}. Add meshes, lights and cameras
 * there, at any depth, and the view finds them.
 *
 * The view holds the {@link View3D#camera | camera} and the settings for the whole scene: tone
 * mapping, exposure, fog, environment light, background and shadows. Some settings are built
 * into material shaders, so changing them recompiles the materials on the next frame:
 * {@link View3D#toneMapping | toneMapping}, {@link View3D#shadowFilter | shadowFilter}, the fog
 * `type`, and the kind of {@link View3D#environment | environment}. Others, such as
 * {@link View3D#exposure | exposure} and the fog distances, are free to change every frame.
 *
 * The view also sends pointer events into the scene. Set {@link Container3D#eventMode | eventMode}
 * on a node and it gets pixi's pointer events (`pointerdown`, `click`, `pointerenter`, the
 * capture phase, the `on*` handlers), hit-tested against its
 * {@link Container3D#hitVolume | hitVolume}. {@link View3D#raycast | raycast} picks without
 * sending an event.
 * @example
 * ```ts
 * import { Application } from 'pixi.js';
 * import { View3D, DirectionalLight } from '@pixi/3d';
 *
 * const app = new Application();
 * await app.init({ resizeTo: window });
 *
 * // Fills the screen and follows it when the canvas resizes.
 * const view = new View3D({ autoResize: true, shadowQuality: 'high', toneMapping: 'aces' });
 * app.stage.addChild(view);
 *
 * view.camera.position.set(0, 2.5, 7);
 *
 * const light = new DirectionalLight({ intensity: 3, castShadow: true });
 * view.root.addChild(light);
 * view.root.addChild(mesh);
 *
 * // A fixed-size inset.
 * const inset = new View3D({ width: 320, height: 240 });
 * ```
 * @see {@link Container3D} For the scene-graph node type used by `root`.
 * @see {@link Camera3D} For the scene camera.
 * @see {@link Hemisphere} For a cheap gradient environment or background.
 * @see {@link Fog} For distance-fog configuration.
 * @see {@link View3DOptions} For all constructor options.
 * @see {@link View3D#events} For how pointer events reach the scene.
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
   * `new View3D(opts)` resolves as `{ ...View3D.defaultOptions, ...opts }`, ignoring options set
   * to `undefined`. Mutate to change the defaults process-wide.
   *
   * It has no `root` or `camera`: each view makes its own, and one set here would be shared by
   * every view.
   * @example
   * ```ts
   * View3D.defaultOptions.shadowQuality = 'high';
   * View3D.defaultOptions.toneMapping = 'reinhard';
   *
   * const view = new View3D();
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

  /**
   * Always `false`: a view takes no pixi children, and 3D content goes under {@link View3D#root | root}
   * @internal
   */
  public override allowChildren = false;

  /**
   * Name of the render pipe that draws this view: `View3DPipeGpu` or `View3DPipeGl`
   * @internal
   */
  public override readonly renderPipeId: string = 'view3d';
  /**
   * Always `false`: the view's own pipe draws it, never pixi's 2D batcher
   * @internal
   */
  public override batched = false;

  /**
   * Root of the 3D scene
   *
   * Add meshes, lights and cameras under it, at any depth, and the view finds them. The view
   * makes an empty one when you don't pass a `root`. Pass it in the options rather than
   * assigning it later: the view only tracks the root it was built with.
   *
   * Typed as whatever you passed as `root`, so a view built around a {@link Model3D} keeps the
   * model's API here.
   * @example
   * ```ts
   * view.root.addChild(mesh);
   * view.root.addChild(light);
   *
   * const modelView = new View3D({ root: new Model3D(source) });
   * modelView.root.player?.play('Wave');
   * ```
   */
  public root: TRoot;

  /**
   * Sends the pointer events pixi delivers to the view on to the 3D nodes under the pointer
   *
   * The 3D counterpart of pixi's `EventBoundary`. The view's `containsPoint`, `cursor`,
   * `hitArea` and `raycast` work through it.
   * @example
   * ```ts
   * const view = new View3D({ width: 800, height: 600 });
   *
   * view.events.enableGlobalMoveEvents = false;
   * ```
   * @see {@link EventBoundary3D} For the pick and dispatch implementation.
   * @see {@link View3D#raycast} For a one-off ray cast that dispatches nothing.
   */
  public readonly events: EventBoundary3D;

  private _camera!: Camera3D;
  private readonly _anchor: ObservablePoint = new ObservablePoint({ _onUpdate: () => this.onViewUpdate() });
  private _width = 0;
  private _height = 0;
  /**
   * Whether the view matches the renderer's screen size on every render
   *
   * Setting {@link View3D#width | width}, {@link View3D#height | height} or
   * {@link View3D#setSize | setSize} turns it off: a size you set is yours to keep. The view
   * reads the screen size at the start of each render, so until its first render it reports the
   * `width` and `height` it was built with.
   * @example
   * ```ts
   * const view = new View3D({ autoResize: true });
   *
   * view.setSize(320, 240); // autoResize is now false
   * view.autoResize = true; // follows the screen again from the next render
   * ```
   * @default false
   */
  public autoResize: boolean;
  /** Set by {@link View3D.from} on an auto-sized view: frame the model once the real aspect is known */
  private _frameOnResize = false;
  private _userOnRender: ((renderer: Renderer) => void) | null = null;

  /**
   * The per-frame hook pixi runs before it updates a frame's transforms, bounds and instructions
   *
   * The screen size is adopted here so 2D consumers of the view's rect (filters, culling,
   * hit-testing) see the new size in the same frame.
   * @param renderer - Renderer drawing this frame.
   * @internal
   */
  public override readonly _onRender = (renderer: Renderer): void => {
    if (this.autoResize) this._resize(renderer.screen.width, renderer.screen.height);
    this._userOnRender?.(renderer);
  };

  /**
   * Callback pixi runs at the start of every render of the stage this view is on, or `null`
   *
   * It runs before the view updates its scene, so changes made in it show in the same frame.
   * @example
   * ```ts
   * view.onRender = () => {
   *   spinner.rotation.y += 0.01;
   * };
   * ```
   */
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
   * Every {@link Light} in the scene, in the order they joined it
   *
   * The view keeps the list in step with the scene, so read it but don't change it: add a light by
   * putting it under {@link View3D#root | root}.
   * @example
   * ```ts
   * for (const light of view.lights) light.intensity *= 0.5;
   * ```
   */
  public lights: Light[] = [];
  /**
   * Size of each shadow map, per side: `'low'` 512, `'medium'` 1024, `'high'` 2048 or `'ultra'`
   * 4096 pixels
   *
   * Each step up takes four times the memory. A change takes effect on the next frame.
   * @default 'medium'
   * @example
   * ```ts
   * view.shadowQuality = isMobile ? 'low' : 'high';
   * ```
   */
  public shadowQuality: ShadowQuality;
  private _shadowFilter: ShadowFilter = 'pcf';
  /**
   * Brightness multiplier for the whole scene, background and fog included, applied before tone
   * mapping
   *
   * Free to change every frame.
   * @example
   * ```ts
   * view.exposure = 1.5;
   * ```
   * @see {@link View3D#toneMapping} For the curve applied after exposure.
   * @default 1.0
   */
  public exposure = 1.0;
  /**
   * Drawn behind the scene: a cube map, a {@link Hemisphere} gradient, or `null` for none
   *
   * It isn't a mesh, so it costs no scene or culling work. Exposure and tone mapping apply to it.
   * Set it to the same object as the {@link View3D#environment | environment} and the sky you see
   * matches the light and reflections the scene receives.
   *
   * A hemisphere is drawn as its gradient for each view direction (see {@link Hemisphere}). It
   * needs no textures, and the view reads its fields every frame, so a change shows on the next
   * render. Switching between a cube map and a hemisphere recompiles the background shader;
   * swapping two cube maps, or changing a hemisphere's fields, doesn't.
   * @example
   * ```ts
   * const env = await Assets.load<CubeTexture>('env.cubemap');
   * view.environment = env;
   * view.background = env; // show the same cube map behind the scene
   *
   * // One hemisphere lights the scene and draws the sky behind it
   * const sky: Hemisphere = { skyColor: 0x88ccff, groundColor: 0x553311 };
   * view.environment = sky;
   * view.background = sky;
   * sky.skyColor = 0xff8800; // sunset, on the next frame
   * ```
   */
  public background: CubeTexture | Hemisphere | null = null;

  private _toneMapping: ToneMapping = 'aces';
  /**
   * Shader bit for the current tone mapping, looked up when `toneMapping` is set
   * @internal
   */
  public _toneMappingBit: ShaderBit | null = TONE_MAPPING_BITS.aces;

  private _fog: Fog | null = null;
  /**
   * Shader bit for the current fog curve, or `null` without fog; read by `MaterialSystemGpu` and
   * `MaterialSystemGl`
   * @internal
   */
  public _fogBit: ShaderBit | null = null;

  private _environment: CubeTexture | Hemisphere | null = null;
  /**
   * Shader bit for the current kind of environment, read by `getPrimaryDescriptor` in
   * `Material3D` and `PhongMaterial`
   *
   * Never `null`: a no-environment bit covers that case, so lit shaders can always call
   * `sampleEnvironment`.
   * @internal
   */
  public _envBit: ShaderBit = envSourceDefaultBit;

  /**
   * Slot allocator for the scene's meshes, whose indices survive removals
   *
   * Freed slots are reused, so pass views, ID buffers and the store buffer can refer to a mesh by
   * its slot index.
   * @internal
   */
  public readonly _meshSlots = new StableList<Mesh3D>();

  /**
   * Every {@link Mesh3D} in the scene, sprites and particle containers included, as a list with no
   * holes for the scene sweep in `updateView3DScene` to walk
   *
   * The order isn't stable: removing a mesh moves the last one into its place.
   * @internal
   */
  public meshes = new UnstableList<Mesh3D>('_allMeshIndex');
  /**
   * Every skinned mesh in the scene, whose bones `updateView3DScene` packs into `_bonePit` each
   * frame
   * @internal
   */
  public _skinnedMeshes = new UnstableList<Mesh3D>('_skinnedMeshIndex');

  /**
   * Every mesh in the scene with a `morph`, which `updateView3DScene` syncs into the shared morph
   * store each frame
   * @internal
   */
  public _morphedMeshes = new UnstableList<Mesh3D>('_morphedMeshIndex');

  /**
   * Batch for the scene's meshes, over the `_meshSlots` array
   *
   * Owns their store buffer, ID buffers and per-pass draw lists. Always `_meshBatches[0]`.
   * @internal
   */
  public readonly _sceneBatch: Mesh3DBatch = new Mesh3DBatch({
    items: this._meshSlots.items as Mesh3DData[],
  });

  /**
   * All batches: `[0]` is always the scene batch, and user batches follow
   * @internal
   */
  public readonly _meshBatches: Mesh3DBatch[] = [this._sceneBatch];

  /**
   * Bumped whenever `_meshBatches` gains or loses a batch
   *
   * Holders of per-batch state, such as `CullResults.removeDetached`, check the live list only when
   * this moves, instead of scanning it every frame.
   * @internal
   */
  public _meshBatchesDirtyId = 0;

  /**
   * How this view culls its meshes outside the camera's view; see {@link CullMode}
   *
   * A {@link BatchedMesh3D} has its own, {@link BatchedMesh3D.cull}. Fixed once the view exists: set
   * it with the `cull` option.
   * @default 'auto'
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only state
  public readonly cull: CullMode;

  /**
   * The pass that owns each draw-list bit, rebuilt by `_ensureInitialized`
   * @internal
   */
  public readonly passByBit: Record<number, RenderPass> = Object.create(null);

  /**
   * Every bit in `passByBit` ORed together; `updateView3DScene` calls `onRenderableDirty` on
   * these passes only
   * @internal
   */
  public _dirtyHookBits = 0;

  /**
   * The render graph that draws this view
   *
   * `_ensureInitialized` builds it from the `graph` option or {@link createDefaultGraph3D}, and
   * builds it again after `passes` changes.
   * @internal
   */
  public _graph!: RenderGraph;

  private _passesInitialized = false;

  /** Graph builder from {@link View3DOptions#graph}, or `undefined` for {@link createDefaultGraph3D} */
  private readonly _buildGraph?: (
    renderer: WebGLRenderer | WebGPURenderer,
    options: DefaultGraph3DOptions,
  ) => RenderGraph;

  /** The `composite` option, passed on to the graph builder; see {@link View3DOptions#composite} */
  private readonly _composite: boolean;

  /** Copy of the array last assigned to {@link View3D#passes} */
  private _passes: readonly Pass3D[] = [];

  /** `_computePassesKey` when the graph was built; a different key on a later frame rebuilds it */
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
   * The `_bonePit` `bufferVersion` that `invalidateGrownStores` in `updateView3DScene` last saw
   *
   * The bone buffer is shared by every batch, so when it grows, every batch's draw caches go.
   * @internal
   */
  public _lastBonePitBufferVersion = 0;

  /**
   * The atlas `bufferVersion` that `restampMorphedGeometry` in `updateView3DScene` last saw
   *
   * A watermark of its own, not the one on the renderer's `View3DGlobalData`:
   * `detectSharedCacheInvalidation` updates that one as it reads it, so whichever check ran first
   * would hide the change from the other.
   * @internal
   */
  public _lastAtlasBufferVersion = 0;

  /**
   * Transform-pass work queue, bucketed by `_relativeSceneDepth` so ancestors are processed
   * before descendants
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
   * @param options - Construction options; see {@link View3DOptions}
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

    this.root = (root ?? new Container3D()) as TRoot;
    this._attach(this.root);

    this.cull = cull ?? 'auto';
    this._sceneBatch.cull = this.cull;
    this.camera = camera ?? new Camera3D();

    Object.assign(this, rest);
    parent?.addChild(this);
  }

  /**
   * Builds a view whose root is a {@link Model3D} of `source`, with a camera and light ready to
   * render it
   *
   * The camera is, in order: `options.camera` as given; the file's first camera node
   * ({@link Model3D#cameras}); or a default {@link Camera3D} placed on the +Z side of the
   * model, facing it, at the closest distance where the sphere around the model's bounds fits
   * the view. An auto-sized view ({@link View3DOptions#autoResize | autoResize}) places that
   * camera on its first render, once the real aspect is known. A file with no lights of its own
   * gets a {@link DirectionalLight} parented under the camera, so it lights whatever the camera
   * looks at; pass `light: false` to skip it.
   * @example
   * ```ts
   * const view = View3D.from(await Assets.load('robot.glb'), { autoResize: true, environment });
   * app.stage.addChild(view);
   * view.root.player?.play('Wave');
   * ```
   * @param source - The loaded glTF or GLB to build the scene from.
   * @param options - View options plus the per-instance model options; see {@link View3DFromOptions}.
   * @returns The view, with `root` typed as the model it holds
   */
  public static from(source: Scene3DSource, options: View3DFromOptions = {}): View3D<Model3D> {
    const { scene, castShadow, receiveShadow, autoUpdate, autoPlay, light, ...viewOptions } = options;
    const root = new Model3D({ source, scene, castShadow, receiveShadow, autoUpdate, autoPlay });
    const camera = viewOptions.camera ?? root.cameras[0];
    const view = new View3D({ ...viewOptions, root, camera });

    if (!camera) {
      if (view.autoResize) view._frameOnResize = true;
      else frameCamera(view.camera, root, view.width / view.height);
    }
    if (light !== false && !view.lights.length) view.camera.addChild(new DirectionalLight());

    return view;
  }

  /**
   * The camera this view draws from
   *
   * A view makes a {@link Camera3D} when you don't pass one. Assigning a camera with no parent adds
   * it to {@link View3D#root | root}. Assigning one that has a parent outside this view's scene
   * throws: add it, or its ancestor, under `view.root` first.
   * @example
   * ```ts
   * view.camera.fov = 45;
   * view.camera.position.set(0, 2.5, 7);
   *
   * const closeUp = new Camera3D({ fov: 30 });
   * view.camera = closeUp;
   * ```
   */
  get camera(): Camera3D {
    return this._camera;
  }

  /**
   * Sets the camera, adding it to {@link View3D#root | root} when it has no parent
   * @param value - Camera to draw from; throws if it has a parent outside this view's scene.
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
   * Where the view's origin sits, as a fraction of its size, like a sprite's anchor
   *
   * `0` puts the origin at the top-left corner, `0.5` centers it, and `1` puts it at the
   * bottom-right. Assign a number for both axes or a point for each.
   * @example
   * ```ts
   * view.anchor = 0.5; // centered
   * view.anchor = { x: 0, y: 1 }; // bottom-left
   * ```
   */
  get anchor(): ObservablePoint {
    return this._anchor;
  }

  /**
   * Sets the anchor from a number for both axes, or a point
   * @param value - Origin as a fraction of the view's size: `0` top-left, `1` bottom-right.
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
   * the view, the same as `TilingSprite.width`.
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
   * the view, the same as `TilingSprite.height`.
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
   * Projects a world-space point, in the space of {@link View3D#root | root}, to pixi's global 2D
   * coordinates
   *
   * The result is in the same space as `event.global` and pixi's `toGlobal`, so you can assign
   * it straight to a 2D object's position or compare it with a pointer. It accounts for the
   * view's {@link View3D#anchor | anchor}, its place on the stage, and the camera's
   * {@link Camera3D#viewport | viewport}. Convert a point in a node's own space with
   * {@link Container3D#toGlobal} first.
   *
   * Returns `null` for a point at or behind a perspective camera, which has no place on screen:
   * the cue to hide a label that tracks it. The test runs in camera space, before the
   * perspective divide, so a point close to the camera plane returns `null` rather than a huge or
   * flipped position. Also returns `null`, and warns once, when the view or the camera's viewport
   * has zero area.
   * @param position - World-space point to project.
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

    camera.getGlobalTransform(_camMatrix, skipUpdate);
    _camMatrix.getInverse(_camMatrix);
    _screenVec.copyFrom(position).applyAffineMatrix4(_camMatrix);

    if (camera.mode === 'perspective' && _screenVec.z >= 0) return null;

    const width = this._width;
    const height = this._height;
    const { x: vx, y: vy, width: vw, height: vh } = camera.viewport;
    const localW = vw * width;
    const localH = vh * height;

    if (!(localW > 0) || !(localH > 0)) {
      warnOnce('View3D.worldToScreen:degenerate', 'View3D.worldToScreen: view size or camera viewport has zero area.');

      return null;
    }

    camera.computeProjection(localW / localH, _projMatrix);
    _screenVec.applyMatrix4(_projMatrix);

    _screenPoint.x = (vx - this._anchor.x) * width + (_screenVec.x * 0.5 + 0.5) * localW;
    _screenPoint.y = (vy - this._anchor.y) * height + (0.5 - _screenVec.y * 0.5) * localH;

    return this.getGlobalTransform(_screenMatrix2D, skipUpdate).apply(_screenPoint, out);
  }

  /**
   * Builds the world-space {@link Ray} through a point in pixi's global 2D coordinates, such as
   * `event.global`
   *
   * The inverse of {@link View3D#worldToScreen | worldToScreen}: every point on the ray projects
   * back to `position`. A perspective camera's ray starts at the camera and passes through the
   * point on its near plane. An orthographic camera's rays run parallel to its forward axis and
   * start on the camera's plane. Either way, `ray.at(t)` is `t` world units from the camera. For
   * a perspective camera that is distance along a slanted ray, not depth: the same `t` across the
   * screen traces a sphere around the camera, not a plane.
   *
   * When the view or the camera's viewport has zero area, it warns once and returns a ray with a
   * zero origin and direction.
   * @param position - 2D global point to cast through, such as `event.global`.
   * @param out - Ray the result is written into. Defaults to a new `Ray`.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @example
   * ```ts
   * view3d.on('pointermove', (e) => {
   *   const ray = view3d.screenToRay(e.global);
   *   const hit = ray.intersectPlane(ground, cursorPos);
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

    if (!(localW > 0) || !(localH > 0)) {
      warnOnce('View3D.screenToRay:degenerate', 'View3D.screenToRay: view size or camera viewport has zero area.');
      out.origin.set(0);
      out.direction.set(0);

      return out;
    }

    this.getGlobalTransform(_screenMatrix2D, skipUpdate).applyInverse(position, _screenPoint);
    const ndcX = ((_screenPoint.x - (vx - this._anchor.x) * width) / localW) * 2 - 1;
    const ndcY = 1 - ((_screenPoint.y - (vy - this._anchor.y) * height) / localH) * 2;

    camera.computeProjection(localW / localH, _projMatrix);
    _projMatrix.getInverse(_projMatrix);
    _screenVec.set(ndcX, ndcY, NEAR_PLANE_NDC_Z).applyMatrix4(_projMatrix);

    camera.getGlobalTransform(_camMatrix, skipUpdate);

    if (camera.mode === 'perspective') {
      _camMatrix.extractPosition(out.origin);
      _screenVec.applyAffineMatrix4(_camMatrix);
      out.direction.copyFrom(_screenVec).subtract(out.origin).normalize();
    } else {
      _screenVec.z = 0;
      _screenVec.applyAffineMatrix4(_camMatrix, out.origin);
      out.direction.set(0, 0, -1).transformDirection(_camMatrix);
    }

    return out;
  }

  /**
   * Converts a point in pixi's global 2D coordinates, such as `event.global`, to the world-space
   * point `distance` units along its {@link View3D#screenToRay | ray}
   *
   * A 2D point only fixes a line through the scene, so `distance` picks the point on it,
   * measured from the camera.
   * @param position - 2D global point to convert.
   * @param distance - Distance along the ray, in world units from the camera.
   * @param out - Point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @returns The world-space point `distance` units along the ray
   * @example
   * ```ts
   * marker.position.copyFrom(view3d.screenToWorld(e.global, 10));
   * ```
   * @see {@link View3D#worldToScreen} For the reverse direction.
   */
  public screenToWorld(position: PointData, distance: number, out?: Vector3, skipUpdate?: boolean): Vector3;
  /**
   * Converts a point in pixi's global 2D coordinates, such as `event.global`, to where its
   * {@link View3D#screenToRay | ray} meets a plane: the usual way to find the spot on the ground
   * under the pointer
   *
   * Returns `null` when the ray points away from the plane or runs parallel to it.
   * @param position - 2D global point to convert.
   * @param plane - World-space plane to intersect.
   * @param out - Point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @returns The world-space intersection point, or `null` when the ray misses the plane
   * @example
   * ```ts
   * const ground = new Plane(new Vector3(0, 1, 0), 0);
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
   * @example
   * ```ts
   * const spot = view3d.screenToWorld(e.global, ground) ?? view3d.screenToWorld(e.global, 20);
   * ```
   */
  public screenToWorld(position: PointData, target: number | Plane, out?: Vector3, skipUpdate = false): Vector3 | null {
    const ray = this.screenToRay(position, _screenRay, skipUpdate);

    return typeof target === 'number' ? ray.at(target, out) : ray.intersectPlane(target, out);
  }

  /**
   * Tone mapping for the background and every material with `toneMapped` on; see
   * {@link ToneMapping}
   *
   * The curve is built into material shaders, so a change recompiles the materials in this view
   * on the next frame. Switching back to a curve used before reuses the compiled shaders, but
   * every mesh still rebuilds its draw state, so don't change it every frame.
   * @example
   * ```ts
   * view.toneMapping = 'reinhard';
   * ```
   * @see {@link View3D#exposure} For the brightness multiplier applied before the curve.
   */
  public get toneMapping(): ToneMapping {
    return this._toneMapping;
  }

  /**
   * Sets the tone mapping, marking the materials to recompile when it changes
   * @param value - Curve for materials with `toneMapped` on.
   */
  public set toneMapping(value: ToneMapping) {
    if (this._toneMapping === value) return;
    this._toneMapping = value;
    this._toneMappingBit = TONE_MAPPING_BITS[value];
    this._invalidateMaterialShaders();
  }

  /**
   * How soft the edges of this view's shadows are: `'hard'`, `'pcf'` or `'pcf-high'`; see
   * {@link ShadowFilter}
   *
   * The filter is built into the shadow sampling in material shaders, so a change recompiles
   * them, with the same cost as changing {@link View3D#toneMapping | toneMapping}.
   * @default 'pcf'
   * @example
   * ```ts
   * view.shadowFilter = isMobile ? 'hard' : 'pcf-high';
   * ```
   */
  public get shadowFilter(): ShadowFilter {
    return this._shadowFilter;
  }

  /**
   * Sets the shadow filter, marking the materials to recompile when it changes
   * @param value - Edge filtering for the shadows this view draws.
   */
  public set shadowFilter(value: ShadowFilter) {
    if (this._shadowFilter === value) return;
    this._shadowFilter = value;
    this._invalidateMaterialShaders();
  }

  /**
   * Distance fog, or `null` for none, which leaves fog out of every shader
   *
   * The view keeps the object you assign, so changing its `color`, `near`, `far` or `density`
   * later is free. Its `type` is read-only: assign a new object to switch curves. A new curve, or
   * turning fog on or off, recompiles the materials on the next frame, with the same cost as
   * changing {@link View3D#toneMapping | toneMapping}.
   * @example
   * ```ts
   * const haze: Fog = { type: 'linear', color: 0xadb2ba, near: 30, far: 55 };
   *
   * view.fog = haze;
   * haze.far = 80;
   * view.fog = null;
   * ```
   * @see {@link Fog} For the settings and their defaults.
   */
  public get fog(): Fog | null {
    return this._fog;
  }

  /**
   * Sets the fog, marking the materials to recompile when the curve changes
   * @param value - Fog settings, kept by reference, or `null` for none.
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
   * Passes and post effects added to this view
   *
   * One list holds both kinds: a {@link MeshPass} redraws the meshes that opt in at its stage, a
   * {@link PostEffect} filters the finished image, and any other {@link Pass3D} runs where it
   * says. Each item knows where it runs, so the array order only matters among post effects,
   * which run in that order.
   *
   * Assigning a new array rebuilds the render graph on the next render; changing the array in
   * place does nothing. Flipping an item's `enabled` also rebuilds the graph, which suits a
   * settings toggle. For changes every frame, use each item's own properties, which are cheap
   * uniform writes. A view with an enabled post effect draws its scene into a texture first;
   * otherwise it draws straight to the screen (see {@link createDefaultGraph3D}).
   *
   * The items stay yours: replacing the list never destroys them, and one instance can serve
   * several views.
   * @example
   * ```ts
   * view.passes = [new OutlinePass({ width: 0.05 }), new SsaoEffect()];
   * view.passes[1].enabled = false;
   * view.passes = [];
   * ```
   */
  public get passes(): readonly Pass3D[] {
    return this._passes;
  }

  /**
   * Sets the pass list (`null` clears it), tearing down the render graph so the next render rebuilds it
   * @param value - Passes and post effects to run; the array is copied, the items are not.
   */
  public set passes(value: readonly Pass3D[] | null) {
    this._passes = value ? value.slice() : [];
    if (this._passesInitialized) this._teardownGraphForRebuild();
  }

  /**
   * Bitmask of which passes are enabled, compared each frame to spot a flip
   *
   * Pass `i` sets bit `i & 31`, so passes 32 apart share a bit: while one of them is enabled, a
   * flip of the other goes unnoticed.
   */
  private _computePassesKey(): number {
    let key = 0;
    for (let i = 0; i < this._passes.length; i++) {
      if (this._passes[i].enabled) key |= 1 << (i & 31);
    }
    return key;
  }

  /**
   * Tears the render graph down so the next render rebuilds it
   *
   * The rebuild works out the pass list and composite mode again, and the material sweep re-keys
   * every mesh against the new passes.
   *
   * The passes unload first, while this view's global bind group still exists: freeing the shadow
   * map points the shadow slot at the empty depth texture and re-records every bundle that baked
   * the old map before it dies. The new shadow pass starts with an empty map, so every light is
   * asked to redraw its shadow, whatever its update rate.
   */
  private _teardownGraphForRebuild(): void {
    this._unloadPasses();
    for (let i = 0; i < this.lights.length; i++) this.lights[i].refreshShadows();
    this._graph.destroy();
    this._passesInitialized = false;
    this._invalidateMaterialShaders();
  }

  /**
   * Light from the surroundings, which fills in where the direct lights don't reach
   *
   * - A `CubeTexture`: image-based lighting from a cube map, reflections included. The renderer
   *   prefilters each new cube map on the first frame that uses it, a one-off cost it caches.
   * - A {@link Hemisphere}: a cheap gradient from sky to ground, with no textures. A good default
   *   on mobile.
   * - `null`: none. Materials compile without the environment code, and the view skips the setup
   *   an environment needs.
   *
   * Each material shader is built for one kind, so switching between kinds recompiles the
   * materials on the next frame, with the same cost as changing
   * {@link View3D#toneMapping | toneMapping}. Changing a hemisphere's colours is free.
   * @example
   * ```ts
   * view.environment = { skyColor: 0x88ccff, groundColor: 0x553311 };
   *
   * view.environment = await Assets.load<CubeTexture>('studio.cubemap');
   * ```
   * @see {@link Hemisphere} For the gradient.
   */
  public get environment(): CubeTexture | Hemisphere | null {
    return this._environment;
  }

  /**
   * Sets the environment, marking the materials to recompile when its kind changes
   * @param value - Cube map, hemisphere gradient, or `null` for none.
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
   * Marks every mesh and batch item in this view to look up its shader again on the next frame
   *
   * For a view setting that is part of the shader cache key, such as `toneMapping`. The flag
   * makes the scene sweep run `ensureMaterial` again. Material data doesn't change, since a
   * material's struct is fixed at construction, so nothing is uploaded again.
   *
   * The scene batch's items are the `_meshSlots` array, where a removed mesh leaves a `null` until
   * its slot is reused. User batches have no holes, but only process the indices in
   * `_dirtyIndices`, so that list is refilled from the start with every index, replacing any
   * partial list rather than appending past its end.
   */
  private _invalidateMaterialShaders(): void {
    for (let b = 0; b < this._meshBatches.length; b++) {
      const batch = this._meshBatches[b];
      const items = batch.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;

        item._batchDirty = true;
      }
      if (b > 0 && batch._dirtyIndices) {
        for (let i = 0; i < items.length; i++) batch._dirtyIndices[i] = i;
        batch._dirtyCount = items.length;
      }
    }
  }

  /**
   * pixi.js `ViewContainer` hook that sets the view's 2D bounds from
   * {@link View3D#width | width}, {@link View3D#height | height} and
   * {@link View3D#anchor | anchor}, for 2D layout and culling
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
   * Registers `child` and its subtree with this view: sets each node's scene depth, queues its
   * transform update, and indexes the meshes, batches and lights it finds
   *
   * `Container3D.addChild` and `addChildAt` call it without `ancestorPickState`, which the first
   * call works out from the parent chain and the recursion passes down. `events` must exist before the first
   * call, because attaching registers pick candidates on it; that's why the constructor creates
   * it before attaching `root`.
   *
   * - A mesh is marked to look up its shader again, since it may carry one compiled for another
   *   view with different tone mapping or shadow settings.
   * - A barrier (`eventMode: 'none'` or `interactiveChildren: false`) blocks picking for its whole
   *   subtree, and an interactive node below it can't lift the block. An interactive node covers
   *   its subtree. Any other node passes its parent's state on.
   * - A node goes on the pick list when nothing above blocks it and either its own mode makes it
   *   a candidate, or it is `'passive'` with a hit volume under an interactive ancestor, which a
   *   hit on it goes to. Later `eventMode` and `hitVolume` changes reach `events` through their
   *   setters.
   * - Each explicit hit volume clips its descendants, so it counts toward
   *   `events._clipVolumeCount`, which skips all clip work while it is 0.
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
      child._batchDirty = true;
    } else if (child instanceof Light) {
      this.lights.push(child);
    }

    if (
      ancestorPickState !== PICK_BLOCKED &&
      (child._isPickCandidate() || (ancestorPickState === PICK_COVERED && mode !== 'none' && child._hasPickVolume()))
    ) {
      this.events._addInteractive(child);
    }

    if (child._hitVolumeInput !== null) this.events._clipVolumeCount++;
  }

  /**
   * Undoes `View3D._attach` for `child` and its subtree, freeing mesh slots, batches and light
   * entries
   *
   * `Container3D.removeChild` and `removeChildren` call it.
   *
   * - A mesh's `_lastWorldVisible` and `_lastBonePitIndex` reset along with the store row they
   *   describe, so attaching it again works like a first attach. A mesh that comes back hidden
   *   then reads as a visibility flip, which writes its store row: every member of a pass needs a
   *   row, or its id reaches the instance buffer as -1.
   * - A morphed mesh frees its weight slot in the renderer's shared morph store, since being in
   *   the scene is what holds the slot.
   * - A light drops its cached shadow state: each cascade's camera data and, on WebGPU, its cull
   *   results, whose bundles baked the shadow pass's bind group over this view's bone pit. The
   *   shadow pass rebuilds them against whichever view draws the light next.
   * - A node leaves the pick list through its own list slot, so implicit entries (`'passive'`
   *   under an interactive ancestor) go too. Pick state is cleared without a `pointerout`; see
   *   `EventBoundary3D._clearPickState`.
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
      child._lastWorldVisible = 1;
      child._lastBonePitIndex = -1;

      if (child.skeleton) {
        this._skinnedMeshes.remove(child);
      }

      if (child.morph) {
        this._morphedMeshes.remove(child);
        child.morph._store?.freeSlot(child.morph);
      }
    } else if (child instanceof Light) {
      const index = this.lights.indexOf(child);

      if (index > -1) {
        this.lights.splice(index, 1);
      }

      child._releaseShadowState();
    }

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
   * Rebuilds every batch's draw commands next frame
   *
   * The bluntest invalidation: a change normally dirties only the batch and pass it touches.
   * Keep this for what the whole view binds, such as a shared store (materials, bones, morphs,
   * geometry atlas) reallocating under every recorded command.
   * @internal
   */
  public _invalidateDrawCaches(): void {
    for (let b = 0; b < this._meshBatches.length; b++) this._meshBatches[b].invalidateDrawCaches();
  }

  /**
   * Re-records every batch's WebGPU bundles next frame, leaving the draw commands alone
   *
   * Cheaper than {@link View3D#_invalidateDrawCaches}; use it when only state a bundle bakes in
   * changed, such as the shadow-map binding moving to a different texture.
   * @internal
   */
  public _invalidateBundleCaches(): void {
    for (let b = 0; b < this._meshBatches.length; b++) this._meshBatches[b].invalidateBundleCaches();
  }

  /**
   * Not available on `View3D`
   *
   * The view has no child list of its own; add 3D objects under {@link View3D#root | root}
   * with `view.root.addChild()`.
   * @throws {Error} Always.
   * @ignore
   */
  public override addChild<U extends ContainerChild[]>(..._children: U): U[0] {
    throw new Error('View3D.addChild() is not available. Use view.root.addChild() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.removeChild()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override removeChild<U extends ContainerChild[]>(..._children: U): U[0] {
    throw new Error('View3D.removeChild() is not available. Use view.root.removeChild() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.removeChildren()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override removeChildren(_beginIndex?: number, _endIndex?: number): ContainerChild[] {
    throw new Error('View3D.removeChildren() is not available. Use view.root.removeChildren() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.removeChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override removeChildAt<U extends ContainerChild>(_index: number): U {
    throw new Error('View3D.removeChildAt() is not available. Use view.root.removeChildAt() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.getChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override getChildAt<U extends ContainerChild>(_index: number): U {
    throw new Error('View3D.getChildAt() is not available. Use view.root.getChildAt() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.setChildIndex()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override setChildIndex(_child: ContainerChild, _index: number): void {
    throw new Error('View3D.setChildIndex() is not available. Use view.root.setChildIndex() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.getChildIndex()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override getChildIndex(_child: ContainerChild): number {
    throw new Error('View3D.getChildIndex() is not available. Use view.root.getChildIndex() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.addChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override addChildAt<U extends ContainerChild>(_child: U, _index: number): U {
    throw new Error('View3D.addChildAt() is not available. Use view.root.addChildAt() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.swapChildren()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override swapChildren<U extends ContainerChild>(_child: U, _child2: U): void {
    throw new Error('View3D.swapChildren() is not available. Use view.root.swapChildren() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.reparentChild()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override reparentChild<U extends ContainerChild[]>(..._child: U): U[0] {
    throw new Error('View3D.reparentChild() is not available. Use view.root.reparentChild() instead.');
  }

  /**
   * Not available on `View3D`; use `view.root.reparentChildAt()` instead
   * @throws {Error} Always.
   * @ignore
   */
  public override reparentChildAt<U extends ContainerChild>(_child: U, _index: number): U {
    throw new Error('View3D.reparentChildAt() is not available. Use view.root.reparentChildAt() instead.');
  }

  /**
   * Builds the render graph when there is none, from the `graph` option or
   * {@link createDefaultGraph3D}, then indexes its passes in `passByBit`
   *
   * `View3DPipeGpu.execute` and `View3DPipeGl.execute` call it every frame. It first compares the
   * passes' `enabled` flags with the key the graph was built with, an O(passes) check. A flip
   * changes which stages have passes, whether the view composites and the ping-pong slots, so a
   * mismatch tears the graph down for a rebuild; compiled shaders and pooled textures carry over.
   *
   * Both builders get the same options, so one that starts from `createDefaultGraph3D` keeps
   * `passes` and `composite` working. The default builder compiles its graph but a custom one may
   * not, so the graph is compiled again here, which is idempotent and cheap.
   *
   * Materials and `updateView3DScene` reach a pass through its bit in `passByBit`, not through the
   * graph. Passes that take no meshes, such as full-screen effects, own no draw list. Two cameras
   * may share a pass name: one pass owns the list and the others only draw it, and the view
   * camera's pass owns it even when a texture camera's pass comes first. A name used twice without
   * a camera throws, and so does a descriptor on a pass that doesn't own its name, since only the
   * owner's descriptor is used.
   * @param renderer - Renderer the graph is built for.
   * @internal
   */
  public _ensureInitialized(renderer: WebGLRenderer | WebGPURenderer): void {
    if (this._passesInitialized && this._passes.length > 0 && this._passesEnabledKey !== this._computePassesKey()) {
      this._teardownGraphForRebuild();
    }

    if (this._passesInitialized) return;

    const graphOptions: DefaultGraph3DOptions = { composite: this._composite, passes: this._passes };
    this._graph = this._buildGraph
      ? this._buildGraph(renderer, graphOptions)
      : createDefaultGraph3D(renderer, graphOptions).graph;
    this._graph.compile();
    this._passesEnabledKey = this._computePassesKey();

    for (const k in this.passByBit) delete this.passByBit[k];
    this._dirtyHookBits = 0;
    for (const graphPass of this._graph.passes) {
      const pass = graphPass as RenderPass;
      if (pass.bit === RenderPassBit.NONE) continue;
      const owner = this.passByBit[pass.bit];
      if (pass.camera) {
        if (owner) continue;
      } else if (owner && !owner.camera) {
        throw new Error(`Render pass "${pass.name}" is used twice in this view; give the second one a camera.`);
      }
      this.passByBit[pass.bit] = pass;
      this._dirtyHookBits |= pass.bit;
    }

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
   * Frees this view's GPU memory now, for a scene you'll show again later
   *
   * The next render that draws the view rebuilds everything, so nothing needs re-creating by
   * hand. It frees the recorded draw commands and WebGPU bundles, and with them their hold on
   * material textures and geometry buffers; the shadow map; each light's shadow state; the
   * view's uniforms and bind groups; and the GPU copies of the buffers the view owns. CPU data
   * stays: the scene and every typed array, the way a 2D texture keeps its source image across
   * `unload`.
   *
   * It frees the GPU copies for every renderer that drew the view, not only one, so a view shown
   * by two renderers re-uploads on both: a one-frame hitch, not a fault.
   *
   * pixi's renderer garbage collector calls it for a view that has been out of every rendered
   * tree for `gcMaxUnusedTime`. A view still on a rendered stage is never collected, even when
   * hidden. Calling it again, or after {@link View3D#destroy}, does nothing.
   *
   * The order matters. The batches go first, so their recorded draws let go of what they
   * captured. Lights drop their shadow state and ask to redraw it into the next map, whatever
   * their update rate. The passes then free the shadow map while the view's bind groups still
   * exist, so the shadow slot can point at an empty texture first. pixi's own `unload` comes last:
   * each renderer destroys the global data it keeps on the view, bind group before uniform buffer,
   * and the next frame makes it again. Every renderer's data goes, because a WebGPU bind group left
   * alive would keep serving its native bind group over the freed buffers.
   * @example
   * ```ts
   * view.visible = false; // hiding alone never frees anything
   * view.unload();
   * ```
   * @see {@link View3D#destroy} For permanent teardown.
   */
  public override unload(): void {
    for (let i = 0; i < this._meshBatches.length; i++) this._meshBatches[i].unload();

    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      if (!light._gpuShadowData) continue;
      light._releaseShadowState();
      light.refreshShadows();
    }

    this._unloadPasses();

    this._bonePit.unload();

    super.unload();
  }

  /**
   * Frees the GPU state the passes own: the shadow map, and each pass bind group's references to
   * the stores of the renderer the graph was built for
   *
   * `unload` runs it after the batches and lights let go of theirs. The renderer's
   * garbage-collection registry (`View3DGCRegistry`) also runs it on every `unload` event, where
   * `unload` has already freed everything, and for each view when the renderer is destroyed,
   * before the pipe frees those stores. Idempotent.
   * @internal
   */
  public _unloadPasses(): void {
    if (this._passesInitialized) this._graph.unload();
  }

  /**
   * Destroys this view and the GPU resources it owns
   *
   * The view's own GPU state always goes, whatever `options` says: its uniforms and bind groups,
   * its render graph, its bone matrices and its batch of scene meshes. A {@link BatchedMesh3D}
   * owns its own batch, so that stays.
   *
   * The scene under {@link View3D#root | root} isn't a pixi child, so pixi's container teardown
   * never reaches it. With the `children` flag, `root` is destroyed and gets `options`,
   * `geometry`, `material` and `texture` included. Without it, the nodes survive for you to
   * reuse, detached from `root` so none of them points at the freed view.
   *
   * Calling it again does nothing.
   *
   * The order matters. `unload` runs first, so every bind group dies before the buffers it binds.
   * The scene detaches next, while the scene batch can still unwind each mesh's slot. Detaching
   * frees each morphed mesh's slot in the renderer's morph store, which outlives the view; a root
   * that is itself a morphed mesh is never detached, so it frees its slot here. pixi's `destroy`
   * runs last: its second `unload` finds nothing left to free, and the view's child list is
   * empty, so the throwing `removeChildren` override is never reached.
   * @example
   * ```ts
   * view.destroy({ children: true });
   * ```
   * @param options - Teardown options; see {@link Destroy3DOptions}. A boolean stands in for every
   *   flag. Leaving it out destroys nothing shared.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    this.unload();

    if (resolveDestroy3DFlag(options, 'children')) {
      this.root.destroy(options);
    } else {
      this.root.removeChildren(0, this.root.children.length);
      this.root._view3d = null;
    }

    if (this._passesInitialized && this._graph) this._graph.destroy();

    this._bonePit.destroy();

    const morphedMeshes = this._morphedMeshes.items;
    for (let i = 0; i < morphedMeshes.length; i++) {
      const morph = morphedMeshes[i].morph!;
      morph._store?.freeSlot(morph);
    }

    this._sceneBatch.destroy();

    this._meshSlots.items.length = 0;
    this._meshSlots.count = 0;
    this.meshes.clear();
    this._skinnedMeshes.clear();
    this._morphedMeshes.clear();
    this.lights.length = 0;

    for (const depth in this._childrenToUpdate) delete this._childrenToUpdate[depth];

    this.events.destroy();

    for (const k in this.passByBit) delete this.passByBit[k];
    this._dirtyHookBits = 0;

    this._meshBatches.length = 0;

    super.destroy(options);
  }
}
