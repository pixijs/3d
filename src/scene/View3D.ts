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
import { Color, CubeTexture, definedProps, Matrix, ObservablePoint, Point, ViewContainer } from 'pixi.js';

import type { Scene3DSource } from '../assets/Scene3DSource';
import { Mesh3DBatch } from '../core/batcher/Mesh3DBatch';
import type { Mesh3DData } from '../core/batcher/Mesh3DData';
import { BonePit } from '../core/buffers/BonePit';
import { LightDataList } from '../core/LightDataList';
import { MAX_LIGHTS } from '../core/lightLimits';
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
import { TONE_MAPPING_BITS } from '../core/shader/bits/tonemapping/toneMappingBits';
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
     * `extensions.mixin(View3D, myMixin)`, as pixi's 2D `Container` does. The interaction members
     * `containsPoint`, `cursor`, `hitArea` and `raycast` arrive this way.
     */
    interface View3D {}
    /** Augmentation hook for constructor options mixed into {@link View3DOptions} */
    interface View3DOptions {}
  }
}

/**
 * The tone curve and display encode a view applies to what it draws; see {@link View3D#toneMapping}
 *
 * - `'none'` (default): the sRGB encode alone. The scene shows as lit, and anything brighter than 1
 *   clips.
 * - `'aces'`, `'reinhard'` and `'uncharted2'`: a filmic curve that rolls off bright light, then the
 *   sRGB encode. Use one, usually `'aces'`, when strong lights or a bright environment push lit
 *   colour past 1.
 * - `'custom'`: neither. The view outputs raw linear light, for a post effect that does its own
 *   tone mapping and encoding. Leave that effect at the default `'beforeToneMapping'` stage, so it
 *   reads the scene in float with brightness above 1 intact.
 *
 * It applies to every material, lit or unlit, so unlit art such as sprites, particles and flat
 * materials matches pixi 2D under `'none'` at exposure 1, and a filmic curve shifts it too.
 * @example
 * ```ts
 * const view = new View3D({ width, height, toneMapping: 'reinhard' });
 *
 * view.toneMapping = 'aces';
 * ```
 * @category environment
 * @standard
 */
export type ToneMapping = 'aces' | 'reinhard' | 'uncharted2' | 'none' | 'custom';

/**
 * How a view or a {@link BatchedMesh3D} skips what's outside the camera's view
 *
 * - `'gpu'`: culls on the GPU, off the main thread. WebGL, and Safari or any iOS browser for all
 *   but very large batches, cull on the CPU instead. So do blended meshes, which draw sorted back
 *   to front.
 * - `'cpu'`: culls on the CPU every frame. Can suit a frame that waits on the GPU.
 * - `'off'`: draws everything. Suits a scene that always fits in view.
 *
 * A skinned mesh is tested at its bind pose, so an animation that carries it far from that pose
 * can make it vanish near the edge of the screen. Use `'off'` for a view that shows one.
 * @example
 * ```ts
 * const view = new View3D({ cull: 'cpu' });
 * ```
 * @category scene
 * @standard
 */
export type CullMode = 'off' | 'cpu' | 'gpu';

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
   * Fog colour, in display (sRGB) space like every other colour
   *
   * Exposure and the tone curve apply to it as they do to the scene, so give
   * {@link View3D#background} the same colour and fully fogged surfaces meet it with no seam,
   * whatever the tone mapping and exposure.
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
 * pixi's own container options, such as `label`, `position`, `eventMode` and the `on*` handlers,
 * work too.
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
 * @typeParam TRoot - Type of {@link View3DOptions#root | root}, inferred from the `root` you pass.
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
   * Camera to draw from, added to {@link View3DOptions#root | root} when it has no parent; see
   * {@link View3D#camera}
   * @default new Camera3D()
   * @example
   * ```ts
   * const view = new View3D({ camera: new Camera3D({ fov: 45 }) });
   * ```
   */
  camera?: Camera3D;
  /**
   * Width of the 3D viewport in pixels
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
   * Drawn behind the scene: a cube map, a {@link Hemisphere} gradient, a plain colour, or `null`
   * for none; see {@link View3D#background}
   * @default null
   * @example
   * ```ts
   * const view = new View3D({ environment: sky, background: sky });
   *
   * // Pass the fog the same colour and distant geometry melts into the background
   * const misty = new View3D({ background: 0x968c34, fog: { color: 0x968c34, near: 20, far: 60 } });
   * ```
   */
  background?: CubeTexture | Hemisphere | ColorSource | null;
  /**
   * Tone mapping curve; see {@link View3D#toneMapping}
   * @default 'none'
   * @example
   * ```ts
   * const view = new View3D({ toneMapping: 'aces' });
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
   * @default 'gpu'
   * @example
   * ```ts
   * const view = new View3D({ cull: 'off' });
   * ```
   */
  cull?: CullMode;
  /**
   * Draw the scene into its own texture, then onto the screen, instead of straight to the screen
   *
   * The view does this anyway while it has an enabled post effect, an enabled pass that
   * {@link Pass3D#requiredOutputs | requires} a scene output, or a {@link View3D#resolution} other
   * than its target's; {@link View3D#resolution} says when to set it yourself. On a canvas with
   * `antialias` the texture is multisampled too, unless a scene output's format rules that out; see
   * {@link SceneOutput}.
   * @default false
   * @example
   * ```ts
   * const view = new View3D({ width: 320, height: 240, composite: true });
   * ```
   */
  composite?: boolean;
  /**
   * Texels per logical pixel the scene is drawn at, or `'inherit'` for the target's; see
   * {@link View3D#resolution}
   * @default 'inherit'
   * @example
   * ```ts
   * const view = new View3D({ resolution: 1 });
   * ```
   */
  resolution?: number | 'inherit';
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
   * Runs on the first render and again each time the view rebuilds its graph, such as after
   * {@link View3D#passes} is assigned, a pass's `enabled` flips, or {@link View3D#unload}. A rebuild
   * destroys the old graph and its passes, so make the passes inside the callback.
   *
   * Leave it out to use {@link createDefaultGraph3D}; to add passes to that pipeline, use
   * {@link View3DOptions#passes} instead. For a different pipeline, start from
   * `createDefaultGraph3D` and append, or build a bare {@link RenderGraph}. Forward `options`
   * either way: it carries what every graph needs, and keeps `passes`, `composite` and
   * `toneMapping` working. A pass that uses a scene output the graph doesn't attach throws when the
   * view builds it.
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
 * Options for {@link View3D.from}: every {@link View3DOptions} field but `root`, the
 * {@link Model3DOptions} a model takes per instance, and `light`
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
    Pick<Model3DOptions, 'scene' | 'castShadow' | 'receiveShadow' | 'autoUpdate' | 'autoPlay' | 'materials'> {
  /**
   * Add a {@link DirectionalLight} under the camera when the file brings no lights of its own
   *
   * The light follows the camera, so it lights whatever the camera faces. Set to `false` to light
   * the scene yourself.
   * @default true
   * @example
   * ```ts
   * const view = View3D.from(source, { light: false, environment: studio });
   * ```
   */
  light?: boolean;
}

// oxlint-disable-next-line pixijs-3d/require-export-jsdoc, pixijs-3d/require-member-api-doc, no-unused-vars
export interface View3D<TRoot extends Container3D = Container3D> extends PixiMixins.View3D {}

/**
 * A 3D scene drawn inside pixi's 2D display list
 *
 * A `View3D` is a pixi display object: add it to the stage, then move, mask or filter it like a
 * sprite. Everything 3D goes under its {@link View3D#root | root}.
 *
 * The view holds the {@link View3D#camera | camera} and the settings for the whole scene: tone
 * mapping, exposure, fog, environment light, background and shadows. A change to some of them
 * recompiles the materials, so don't change those every frame; each one's doc says which.
 *
 * The view also sends pointer events into the scene. Set {@link Container3D#eventMode | eventMode}
 * on a node and it gets pixi's pointer events, hit-tested against its
 * {@link Container3D#hitVolume | hitVolume}. {@link View3D#raycast | raycast} picks without
 * sending an event. The view itself starts with `eventMode` `'static'`, so it catches the pointer
 * anywhere in its rectangle.
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
 * @see {@link View3DOptions} For all constructor options.
 * @typeParam TRoot - Type of {@link View3D#root}, inferred from the `root` you pass.
 * @category scene
 * @standard
 */
export class View3D<TRoot extends Container3D = Container3D> extends ViewContainer<View3DGlobalData> {
  /**
   * Defaults for every new `View3D`; an option passed as `undefined` keeps its default
   *
   * Don't set `root` or `camera` here: every view would share the one object.
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
    toneMapping: 'none',
    exposure: 1.0,
    autoResize: false,
  };

  /** @internal */
  public override allowChildren = false;

  /**
   * The `name` that `View3DPipeGpu` and `View3DPipeGl` register under
   * @internal
   */
  public override readonly renderPipeId: string = 'view3d';
  /** @internal */
  public override batched = false;

  /**
   * Root of the 3D scene
   *
   * Add meshes and lights under it, at any depth, and the view finds them. Pass it in the options
   * rather than assigning it later: the view only tracks the root it was built with.
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
   * Sends the pointer events pixi delivers to the view on to the 3D nodes under the pointer; the
   * 3D counterpart of pixi's `EventBoundary`
   *
   * It listens on the view itself, so `view.removeAllListeners()`, or `view.off(type)` without a
   * handler, stops 3D events for good; pass your handler to `off`.
   * @example
   * ```ts
   * const view = new View3D({ width: 800, height: 600 });
   *
   * view.events.enableGlobalMoveEvents = false;
   * ```
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
   * {@link View3D#setSize | setSize} turns it off. The view reads the screen size at the start of
   * each render, so until its first render it reports the `width` and `height` it was built with.
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
  private _frameOnResize = false;
  private _userOnRender: ((renderer: Renderer) => void) | null = null;

  /**
   * Takes the screen size before pixi updates bounds, so filters, culling and hit tests see it the same frame
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
   * Size of each shadow map; see {@link ShadowQuality}
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
   * It scales unlit materials too, in linear light, so at 2 an unlit colour draws about 1.37 times
   * as bright on screen. Free to change every frame.
   * @example
   * ```ts
   * view.exposure = 1.5;
   * ```
   * @default 1.0
   */
  public exposure = 1.0;
  private _background: CubeTexture | Hemisphere | number | null = null;

  private _toneMapping: ToneMapping = 'none';
  /**
   * `null` while the scene draws as linear light: under `'custom'`, or while a graph pass applies the curve
   * @internal
   */
  public _toneMappingBit: ShaderBit | null = TONE_MAPPING_BITS.none;

  private _fog: Fog | null = null;
  /** @internal */
  public _fogBit: ShaderBit | null = null;

  private _environment: CubeTexture | Hemisphere | null = null;
  /**
   * Never `null`: with no environment, a default bit still gives lit shaders `sampleEnvironment`
   * @internal
   */
  public _envBit: ShaderBit = envSourceDefaultBit;

  /**
   * Indices never move, since ID buffers and store rows refer to a mesh by its slot; `meshes` is the dense list
   * @internal
   */
  public readonly _meshSlots = new StableList<Mesh3D>();

  /** @internal */
  public meshes = new UnstableList<Mesh3D>('_allMeshIndex');
  /** @internal */
  public _skinnedMeshes = new UnstableList<Mesh3D>('_skinnedMeshIndex');

  /** @internal */
  public _morphedMeshes = new UnstableList<Mesh3D>('_morphedMeshIndex');

  /**
   * Destroyed after the scene detaches through it, and after `unload` frees the bind groups over its buffers
   *
   * Holds `_meshSlots.items` itself, which `StableList` never replaces.
   * @internal
   */
  public readonly _sceneBatch: Mesh3DBatch = new Mesh3DBatch({
    items: this._meshSlots.items as Mesh3DData[],
  });

  /**
   * `[0]` is always the scene batch, and user batches follow
   * @internal
   */
  public readonly _meshBatches: Mesh3DBatch[] = [this._sceneBatch];

  /**
   * Bumped whenever `_meshBatches` gains or loses a batch, so holders of per-batch state rescan only then
   * @internal
   */
  public _meshBatchesDirtyId = 0;

  /**
   * The pass that owns each draw-list bit
   * @internal
   */
  public readonly passByBit: Record<number, RenderPass> = Object.create(null);

  /**
   * Every bit in `passByBit` ORed together
   * @internal
   */
  public _dirtyHookBits = 0;

  /**
   * Valid only while `_passesInitialized`; a teardown leaves the destroyed graph here
   * @internal
   */
  public _graph!: RenderGraph;

  private _passesInitialized = false;

  private _graphGlobalData: View3DGlobalData | null = null;

  private readonly _buildGraph?: (
    renderer: WebGLRenderer | WebGPURenderer,
    options: DefaultGraph3DOptions,
  ) => RenderGraph;

  private readonly _composite: boolean;

  /**
   * The `composite` asked of the graph builder, not whether the graph composites; comparing the
   * request keeps a view with a post effect from rebuilding every frame
   */
  private _compositeRequested = false;

  private _passes: readonly Pass3D[] = [];

  private _passesEnabledKey = 0;

  /** @internal */
  public readonly _lightDataList = new LightDataList();
  /** @internal */
  public readonly _shadowDataList = new ShadowDataList();
  /**
   * Whether lit shaders compile shadow sampling; never turns back off, so toggling a shadow recompiles nothing
   * @internal
   */
  public _hasShadows = false;
  /** @internal */
  public _bonePit = new BonePit();

  /** @internal */
  public _lastBonePitBufferVersion = 0;

  /**
   * A watermark of its own, apart from `View3DGlobalData.lastAtlasBufferVersion`: with one shared
   * watermark, whichever check read it first would hide the change from the other
   * @internal
   */
  public _lastAtlasBufferVersion = 0;

  /**
   * Transform update queue, bucketed by `_relativeSceneDepth` so parents update before children
   * @internal
   */
  public readonly _childrenToUpdate: Record<number, { list: Container3D[]; index: number }> = Object.create(null);

  /**
   * Meshes queued for the next scene update; only the first `index` entries are live, and the
   * drain skips one that has left the view
   * @internal
   */
  public readonly _renderablesToUpdate: { list: Mesh3D[]; index: number } = { list: [], index: 0 };
  /** @internal */
  public _updateTick = 0;

  /** @param options - See {@link View3DOptions}. */
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
      resolution,
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
    this.exposure = exposure!;
    this._composite = composite ?? false;
    this.resolution = resolution ?? 'inherit';
    this._buildGraph = graph;
    if (passes) this._passes = passes.slice();

    if (fog) this.fog = fog;

    this.anchor = anchor!;
    this._width = width!;
    this._height = height!;
    this.autoResize = autoResize!;

    this.root = (root ?? new Container3D()) as TRoot;
    this._attach(this.root);

    this._sceneBatch.cull = cull ?? 'gpu';
    this.camera = camera ?? new Camera3D();

    Object.assign(this, rest);
    parent?.addChild(this);
  }

  /**
   * Builds a view whose root is a {@link Model3D} of `source`, with a camera and light ready to
   * render it
   *
   * The camera is `options.camera`, else the file's first camera, else a new {@link Camera3D} on
   * the model's +Z side, facing it, just far enough back that the sphere around the model's bounds
   * fits the view. An auto-sized view places that camera on its first render, once it knows its
   * aspect. That camera's near and far planes sit at a hundredth and a hundred times its distance
   * from the model. A file with no lights gets one; see {@link View3DFromOptions#light}.
   * @example
   * ```ts
   * const view = View3D.from(await Assets.load('robot.glb'), { autoResize: true, environment });
   * app.stage.addChild(view);
   * view.root.player?.play('Wave');
   * ```
   * @param source - The loaded glTF or GLB to build the scene from.
   * @param options - View options plus the per-instance model options; see {@link View3DFromOptions}.
   */
  public static from(source: Scene3DSource, options: View3DFromOptions = {}): View3D<Model3D> {
    const { scene, castShadow, receiveShadow, autoUpdate, autoPlay, materials, light, ...viewOptions } = options;
    const root = new Model3D({ source, scene, castShadow, receiveShadow, autoUpdate, autoPlay, materials });
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
   * Assigning a camera with no parent adds it to {@link View3D#root | root}. Assigning one that has
   * a parent outside this view's scene throws: add it, or its ancestor, under `view.root` first.
   * A render with meshes to draw throws while the camera or any of its parents is hidden, or once
   * it leaves the scene without a new camera assigned.
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
   * Sets the camera
   * @param value - Camera to draw from.
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
   * Sets the anchor
   * @param value - A number for both axes, or a point.
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
   * Sets the width
   * @param value - Width in pixels.
   */
  override set width(value: number) {
    this.setSize(value, this._height);
  }

  /**
   * Height of the 3D viewport in pixels; setting it resizes the viewport, as
   * {@link View3D#width | width} does
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
   * Sets the height
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
   * Projects a world-space point, such as one from {@link Container3D#getGlobalPosition}, to pixi's
   * global 2D coordinates
   *
   * The result is in the same space as `event.global`, so you can assign it straight to a 2D
   * object's position. It accounts for the view's {@link View3D#anchor | anchor}, its place on the
   * stage, and the camera's {@link Camera3D#viewport | viewport}. Convert a point in a node's own
   * space with {@link Container3D#toGlobal} first.
   *
   * Returns `null` for a point at or behind a perspective camera: the cue to hide a label that
   * tracks it. Also returns `null`, and warns once, when the view or the camera's viewport has
   * zero area. With {@link View3D#autoResize | autoResize}, the view takes the screen size only as
   * it draws, so a label placed from `app.ticker` lags a frame after a resize; size a view that
   * carries labels from the renderer's `resize` event instead.
   * @param position - World-space point to project.
   * @param out - 2D point the result is written into. Defaults to a new `Point`.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
   * @example
   * ```ts
   * const label = new Text({ text: 'player' });
   * const world = new Vector3();
   * const screen = new Point();
   * app.stage.addChild(label);
   *
   * app.ticker.add(() => {
   *   // Reused out objects keep the per-frame code from allocating
   *   const p = view3d.worldToScreen(mesh.getGlobalPosition(world), screen);
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
   * back to `position`. A perspective camera's ray starts at the camera; an orthographic camera's
   * starts on the camera's plane and runs along its forward axis. Either way, `ray.at(t)` is `t`
   * world units from the camera, which for a perspective camera is distance along a slanted ray,
   * not depth.
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
   * @param position - 2D global point to convert.
   * @param distance - Distance along the ray, in world units from the camera.
   * @param out - Point the result is written into. Defaults to a new {@link Vector3}.
   * @param skipUpdate - `true` to use cached transforms (see {@link Container3D#getGlobalTransform}).
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
   * Tone mapping for everything the view draws; see {@link ToneMapping}
   *
   * With no enabled `'beforeToneMapping'` effect in {@link View3D#passes | passes}, the curve is
   * built into the material shaders, and a change recompiles them on the next frame. With one, the
   * scene draws as linear light, so the effects see brightness above 1, and the curve runs once
   * over the whole image after the last of them; a change rebuilds the render graph. Either way, don't change it every
   * frame.
   *
   * The two look the same apart from see-through surfaces: with an effect, transparent surfaces
   * blend, and glass refracts, in linear light before the curve.
   * @example
   * ```ts
   * view.toneMapping = 'reinhard';
   * ```
   */
  public get toneMapping(): ToneMapping {
    return this._toneMapping;
  }

  /**
   * Sets the tone mapping
   * @param value - The curve for everything the view draws.
   */
  public set toneMapping(value: ToneMapping) {
    if (this._toneMapping === value) return;
    this._toneMapping = value;
    if (this._passesInitialized && this._graph.sceneIsLinear) {
      this._teardownGraph();
      return;
    }
    this._toneMappingBit = TONE_MAPPING_BITS[value];
    this._invalidateMaterialShaders();
  }

  /**
   * How this view culls its meshes outside the camera's view; see {@link CullMode}
   *
   * A change rebuilds nothing. A {@link BatchedMesh3D} ignores it and culls by its own
   * {@link BatchedMesh3D#cull | cull}.
   * @default 'gpu'
   * @example
   * ```ts
   * view.cull = gpuBound ? 'cpu' : 'gpu';
   * ```
   */
  public get cull(): CullMode {
    return this._sceneBatch.cull;
  }

  /**
   * Sets how this view culls its meshes
   * @param value - The culling mode.
   */
  public set cull(value: CullMode) {
    this._sceneBatch.cull = value;
  }

  /**
   * Texels per logical pixel the scene is drawn at, or `'inherit'` to take the resolution of the
   * 2D target the view lands on
   *
   * Absolute, like a pixi filter's `resolution`: `1` on a DPR 2 screen draws the scene at half the
   * physical size and stretches it over the view. Lower it for dynamic resolution when a device
   * falls behind. Post effects' textures follow it unless an effect sets its own, and
   * `Camera3D.jitter` comes out in the scene's pixels.
   *
   * A resolution other than the target's turns on {@link View3DOptions#composite | composite mode}.
   * Turning composite mode on or off rebuilds the render graph on the next render, like assigning
   * {@link View3D#passes}, so a dynamic-resolution loop that returns to the target's resolution
   * rebuilds at every crossing; `composite: true`, or an enabled post effect, keeps that to once at
   * most. Any other change rebuilds nothing, and allocates new textures only when the size crosses
   * a power of two or the canvas size.
   * @default 'inherit'
   * @example
   * ```ts
   * // Draw the scene at two thirds of the screen's width and height
   * view.resolution = app.renderer.resolution * 0.67;
   * ```
   */
  public resolution: number | 'inherit';

  /**
   * How soft the edges of this view's shadows are; see {@link ShadowFilter}
   *
   * Once a light in the view casts shadows, a change recompiles the materials on the next frame;
   * before that it compiles nothing.
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
   * Sets the shadow filter
   * @param value - Edge filtering for the shadows this view draws.
   */
  public set shadowFilter(value: ShadowFilter) {
    if (this._shadowFilter === value) return;
    this._shadowFilter = value;
    this._invalidateMaterialShaders();
  }

  /**
   * Distance fog, or `null` for none
   *
   * The view keeps the object you assign, so changing its `color`, `near`, `far` or `density`
   * later is free. A new curve, or turning fog on or off, recompiles the materials on the next
   * frame, like changing {@link View3D#toneMapping | toneMapping}.
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
   * Sets the fog
   * @param value - Fog settings, or `null` for none.
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
   * {@link PostEffect} filters the scene's light or the finished picture, and any other
   * {@link Pass3D} runs where it says. Items at the same stage run in array order, and the post
   * effects run `'beforeToneMapping'` ones first, then the tone curve, then `'afterToneMapping'`
   * ones.
   *
   * Assigning a new array rebuilds the render graph on the next render; changing the array in
   * place does nothing. Flipping an item's `enabled` also rebuilds the graph, which suits a
   * settings toggle; for changes every frame, use each item's own properties. Turning a scene
   * output on or off recompiles the materials on the next frame, and so does turning on the first
   * `'beforeToneMapping'` effect or turning off the last.
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
   * Sets the pass list; `null` clears it
   * @param value - Passes and post effects to run; the array is copied.
   */
  public set passes(value: readonly Pass3D[] | null) {
    this._passes = value ? value.slice() : [];
    if (this._passesInitialized) this._teardownGraph();
  }

  /** Bit `i & 31` per enabled pass, so a flip goes unnoticed while the pass 32 places away is enabled */
  private _computePassesKey(): number {
    let key = 0;
    for (let i = 0; i < this._passes.length; i++) {
      if (this._passes[i].enabled) key |= 1 << (i & 31);
    }
    return key;
  }

  /**
   * Needs the view's bind group, so `unload` runs it before pixi's own; the passes unload before the
   * graph is destroyed, and every light redraws its shadow, since the new shadow map starts empty
   */
  private _teardownGraph(): void {
    this._graph.unload();
    for (let i = 0; i < this.lights.length; i++) this.lights[i].refreshShadows();
    this._graph.destroy();
    this._passesInitialized = false;
    this._graphGlobalData = null;
    this._invalidateMaterialShaders();
  }

  /**
   * Light from the surroundings, which fills in where the direct lights don't reach
   *
   * - A `CubeTexture`: image-based lighting from a cube map, reflections included. The first frame
   *   that uses a cube map prefilters it, once, into a copy 128 to 256 pixels wide per face that
   *   lighting and reflections read, so faces wider than 256 sharpen the background but not
   *   reflections. The copy stays on the GPU until the cube map is destroyed with `destroy(true)` or
   *   `Assets.unload`, even after the view switches away. A float cube, such as one {@link loadHdr}
   *   makes from an `.hdr` file, is read as linear light, so an HDR environment keeps highlights
   *   brighter than white; any other format is read as sRGB. On WebGL the prefilter needs
   *   `EXT_color_buffer_float`, and throws without it.
   * - A {@link Hemisphere}: a cheap gradient from sky to ground, with no textures. A good default
   *   on mobile.
   * - `null`: none, and the cheapest.
   *
   * Switching between kinds recompiles the materials on the next frame, like changing
   * {@link View3D#toneMapping | toneMapping}. Changing a hemisphere's colours is free.
   * @example
   * ```ts
   * view.environment = { skyColor: 0x88ccff, groundColor: 0x553311 };
   *
   * view.environment = await Assets.load<CubeTexture>('studio.cubemap');
   *
   * // An HDR panorama keeps the sun brighter than white
   * view.environment = await Assets.load<CubeTexture>('sunset.hdr');
   * ```
   */
  public get environment(): CubeTexture | Hemisphere | null {
    return this._environment;
  }

  /**
   * Sets the environment
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
   * Drawn behind the scene: a cube map, a {@link Hemisphere} gradient, a plain colour, or `null`
   * for none
   *
   * Exposure and tone mapping apply to it. Set it to the same object as the
   * {@link View3D#environment | environment} and the sky you see matches the light and reflections
   * the scene receives. A hemisphere's fields are read every frame, so changing them is free. A view
   * with no meshes draws nothing, background included, until a mesh joins its scene.
   *
   * A colour takes any `ColorSource` in display (sRGB) space and reads back as a hex number; its
   * alpha is ignored. Exposure and the tone curve shift it on screen: under `'aces'`, white draws
   * as light grey. To fade distant geometry into it, give the fog the same
   * {@link Fog#color | color}. For a flat backdrop with no fog that shows the exact colour, leave
   * `background` null and set the app's `backgroundColor`, which is never tone-mapped.
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
   *
   * // Distant geometry fades into a plain background
   * view.background = 'skyblue';
   * view.fog = { type: 'linear', color: 'skyblue', near: 20, far: 60 };
   * view.background; // 0x87ceeb
   * ```
   */
  public get background(): CubeTexture | Hemisphere | number | null {
    return this._background;
  }

  /**
   * Sets the background
   * @param value - Cube map, hemisphere gradient, display-space colour, or `null` for none.
   */
  public set background(value: CubeTexture | Hemisphere | ColorSource | null) {
    this._background =
      value === null || value instanceof CubeTexture || (typeof value === 'object' && 'skyColor' in value)
        ? value
        : Color.shared.setValue(value).toNumber();
  }

  /**
   * Turns shadow sampling on once one of the first `MAX_LIGHTS` packed lights casts
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

  /** Refills each user batch's `_dirtyIndices` from the start, since appending every index could run past its end */
  private _invalidateMaterialShaders(): void {
    const meshes = this.meshes.items;
    for (let i = 0; i < meshes.length; i++) meshes[i]._markBatchDirty();

    for (let b = 1; b < this._meshBatches.length; b++) {
      const batch = this._meshBatches[b];
      const items = batch.items;
      for (let i = 0; i < items.length; i++) items[i]._batchDirty = true;
      if (batch._dirtyIndices) {
        for (let i = 0; i < items.length; i++) batch._dirtyIndices[i] = i;
        batch._dirtyCount = items.length;
      }
    }
  }

  /**
   * Queues a mesh for the next scene update; `Mesh3D._queueMeshUpdate` makes sure it isn't queued already
   * @internal
   */
  public _onRenderableUpdate(mesh: Mesh3D): void {
    const queue = this._renderablesToUpdate;
    queue.list[queue.index++] = mesh;
  }

  /** @internal */
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
   * Registers `child` and its subtree; pick state follows the rule of `getAncestorPickState` in
   * `FederatedEventTarget3D.ts`, and `events` must exist first, since picking registers on it
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

      if (child._morph) {
        this._morphedMeshes.add(child);
      }
      child.geometry._meshes.add(child);
      child.material._meshes.add(child);
      child._markBatchDirty();
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
   * Unregisters `child` and its subtree; a mesh's `_lastWorldVisible` resets so one that comes back
   * hidden still writes its store row. The root never detaches, so `destroy` frees its mesh lists and morph slot.
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
      this._sceneBatch.setPassesAt(slotIndex, 0);

      this._meshSlots.remove(child);
      this.meshes.remove(child);
      this._sceneBatch.storeBuffer.remove(child);
      child.geometry._meshes.remove(child);
      child.material._meshes.remove(child);
      child.didRenderableUpdate = false;
      child._lastWorldVisible = 1;
      child._lastBonePitIndex = -1;

      if (child.skeleton) {
        this._skinnedMeshes.remove(child);
      }

      if (child._morph) {
        this._morphedMeshes.remove(child);
        child._morph._store?.freeSlot(child._morph);
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

  /** @internal */
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
   * Rebuilds every batch's draw commands next frame; keep it for what the whole view binds, such as a
   * shared store reallocating
   * @internal
   */
  public _invalidateDrawCaches(): void {
    for (let b = 0; b < this._meshBatches.length; b++) this._meshBatches[b].invalidateDrawCaches();
  }

  /**
   * Re-records every batch's WebGPU bundles next frame, keeping the draw commands
   * @internal
   */
  public _invalidateBundleCaches(): void {
    for (let b = 0; b < this._meshBatches.length; b++) this._meshBatches[b].invalidateBundleCaches();
  }

  /**
   * Lets go of the pooled textures this view still binds, before pixi's texture pool destroys them;
   * without a graph there's nothing to do, since its teardown already let them go
   * @internal
   */
  public _releasePooledTextures(): void {
    if (!this._passesInitialized) return;
    this._graph._releaseTransients();
    this._invalidateBundleCaches();
  }

  /**
   * Not available on `View3D`; use `view.root.addChild()` instead
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
   * Builds the render graph when there is none or it went stale, compiling it again since a custom
   * builder may not have; the view camera's pass owns a shared draw-list bit even when a texture camera's comes first
   * @throws If the graph was built with another renderer's global data.
   * @internal
   */
  public _ensureInitialized(
    renderer: WebGLRenderer | WebGPURenderer,
    globalData: View3DGlobalData,
    targetResolution: number,
  ): void {
    const sceneResolution = this.resolution === 'inherit' ? targetResolution : this.resolution;
    const composite = this._composite || sceneResolution !== targetResolution;

    if (this._passesInitialized) {
      const passesChanged = this._passes.length > 0 && this._passesEnabledKey !== this._computePassesKey();
      const compositeChanged =
        composite !== this._compositeRequested && !(composite && this._graph.sceneColor !== this._graph.defaultColor);
      if (passesChanged || compositeChanged) this._teardownGraph();
    }

    if (this._passesInitialized) {
      if (this._graphGlobalData !== globalData) {
        throw new Error('View3D: a view renders with one renderer; its render graph was built for another');
      }
    } else {
      this._graphGlobalData = globalData;

      const graphOptions: DefaultGraph3DOptions = {
        composite,
        passes: this._passes,
        toneMapping: this._toneMapping,
        globalTextureBindings: globalData.globalTextureBindings,
      };
      this._graph = this._buildGraph
        ? this._buildGraph(renderer, graphOptions)
        : createDefaultGraph3D(renderer, graphOptions).graph;
      this._graph.compile();
      this._toneMappingBit = this._graph.sceneIsLinear ? null : TONE_MAPPING_BITS[this._toneMapping];
      this._passesEnabledKey = this._computePassesKey();
      this._compositeRequested = composite;

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

    this._graph.resolution = this._graph.sceneColor === this._graph.defaultColor ? targetResolution : sceneResolution;
  }

  /**
   * Frees this view's GPU memory now, for a scene you'll show again later
   *
   * The next render that draws the view rebuilds everything, so nothing needs re-creating by
   * hand. It frees the view's draw state, shadow map, uniforms and buffers, and keeps CPU data:
   * the scene and every typed array, the way a 2D texture keeps its source image across `unload`.
   * The scene's geometry and textures stay on the GPU; {@link Container3D#unload} says how to free them.
   *
   * pixi's garbage collector calls it for a view that has been out of the stage for
   * `gcMaxUnusedTime`. It never collects a view still in a stage, even a hidden one, nor one that
   * is a render group or left the stage inside one (`isRenderGroup`, `cacheAsTexture`, or rendered
   * directly, as `extract` does); set `autoGarbageCollect` to `false` to keep any view.
   * @example
   * ```ts
   * view.visible = false; // hiding alone never frees anything
   * view.unload();
   * ```
   * @see {@link View3D#destroy} For permanent teardown.
   */
  public override unload(): void {
    if (this.destroyed) return;

    for (let i = 0; i < this._meshBatches.length; i++) this._meshBatches[i].unload();

    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      if (!light._gpuShadowData) continue;
      light._releaseShadowState();
      light.refreshShadows();
    }

    this._bonePit.unload();

    if (this._passesInitialized) this._teardownGraph();

    super.unload();
  }

  /**
   * Destroys this view and the GPU resources it owns
   *
   * The view's own GPU state always goes, whatever `options` says. With the `children` flag,
   * {@link View3D#root | root} is destroyed too, with the same `options`, so the `geometry`,
   * `material` and `texture` flags apply to it. Without the flag, the scene's nodes survive for you
   * to reuse, but they're removed from `root`, which is left empty.
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

    const root = this.root;
    if (root instanceof Mesh3D && !root.destroyed) {
      root.geometry._meshes.remove(root);
      root.material._meshes.remove(root);
      root.didRenderableUpdate = false;
    }

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
      const morph = morphedMeshes[i]._morph!;
      morph._store?.freeSlot(morph);
    }

    this._sceneBatch.destroy();

    this._meshSlots.items.length = 0;
    this._meshSlots.count = 0;
    (this.meshes as UnstableList<Mesh3D> | null) = null;
    (this._skinnedMeshes as UnstableList<Mesh3D> | null) = null;
    (this._morphedMeshes as UnstableList<Mesh3D> | null) = null;
    (this._childrenToUpdate as View3D['_childrenToUpdate'] | null) = null;
    (this._renderablesToUpdate as View3D['_renderablesToUpdate'] | null) = null;

    this.events.destroy();

    (this.passByBit as Record<number, RenderPass> | null) = null;
    this._dirtyHookBits = 0;

    super.destroy(options);

    (this.lights as Light[] | null) = null;
    (this._meshBatches as Mesh3DBatch[] | null) = null;
  }
}
