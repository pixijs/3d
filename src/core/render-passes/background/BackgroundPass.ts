import { BindGroup } from 'pixi.js';
import type { Geometry, Shader, State, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import { getCameraData } from '../../CameraData';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import { CUBETEXTURE_EMPTY } from '../../textures/DefaultTextures';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';
import {
  backgroundBit,
  backgroundGlTemplate,
  createBackgroundGeometry,
  createBackgroundState,
} from './backgroundPassUtils';

/**
 * Shader template for the background (skybox) pass — WGSL + GLSL
 *
 * WebGPU uses both fields via `compilePassShader`; WebGL reads only `gl`.
 */
const backgroundTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'background'],
  gpu: /* wgsl */ `
{{header}}

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // aPosition is already a world-space direction for the skybox cube.
  // Rotating the lookup direction again with camera rotation would over-rotate.
  output.vDir = input.aPosition;

  // Remove translation from the view so the skybox stays "infinitely far"
  var view = camera.uViewMatrix;
  view[3] = vec4<f32>(0.0, 0.0, 0.0, view[3].w);

  let clip = camera.uProjectionMatrix * view * vec4<f32>(input.aPosition, 1.0);
  // Force depth to far plane (z = w)
  output.position = vec4<f32>(clip.x, clip.y, clip.w, clip.w);

  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  let sample = textureSample(uCube, uCubeSampler, normalize(input.vDir));
  // Gamma 2.2 sRGB decode: the cubemap holds sRGB, the tone-map curve expects
  // linear and re-encodes on output. Matches the 1/2.2 encode.
  let sampleLinear = pow(sample.rgb, vec3<f32>(2.2));
  var finalColor = sampleLinear * global.uExposure;
  {{fragmentEnd}}
  return vec4<f32>(finalColor, sample.a);
}
`,
  gl: backgroundGlTemplate,
};

/**
 * Options for constructing a {@link BackgroundPass}
 * @category rendering
 * @advanced
 */
export interface BackgroundPassOptions {
  /** Renderer the pass draws with: the {@link PassContext#renderer} a {@link Pass3D#build} call receives */
  renderer: WebGLRenderer | WebGPURenderer;
  /**
   * Camera to draw the sky from
   *
   * Omitted, the pass draws from the view's own camera into the view. Given one, it draws from
   * that camera into that camera's target: its `viewport` rect, or its render texture. See
   * {@link RenderPassOptions#camera}.
   */
  camera?: Camera3D;
}

/**
 * Draws the view's {@link View3D#background} cubemap behind the scene
 *
 * The sky is a cube around the camera with the camera's translation removed, so it stays at
 * infinity however the camera moves. It runs the view's {@link View3D#exposure} and
 * {@link View3D#toneMapping} curve, so it matches the materials that reflect the same
 * environment. The pass skips any frame where the view has no background.
 *
 * The draw writes colour only, with depth test and depth write off, so it paints over anything
 * already on its target: add it before its camera's opaque draw. The default graph runs one for
 * the view's camera straight after the per-view depth clear and before the opaque pass.
 *
 * Any other camera draws no sky of its own. To give it one, add a `BackgroundPass` with that
 * `camera` from a {@link Pass3D#build}, ahead of the camera's opaque draw.
 * @category rendering
 * @advanced
 */
export class BackgroundPass extends RenderPass {
  private readonly _geometry: Geometry;
  private readonly _state: State;
  private readonly _backgroundBindGroup: BindGroup;
  private _shader: Shader | null = null;
  /** Tone-map bit baked into `_shader` — used to detect View changes */
  private _cachedToneBit: ShaderBit | null = null;
  private _destroyed = false;

  constructor(options: BackgroundPassOptions) {
    super({
      renderer: options.renderer,
      name: 'background',
      description: 'Draws the View3D cubemap background behind scene geometry.',
      bit: RenderPassBit.BACKGROUND,
      camera: options.camera,
    });
    this._geometry = createBackgroundGeometry();
    this._state = createBackgroundState();
    this._backgroundBindGroup = new BindGroup({
      0: CUBETEXTURE_EMPTY.source,
      1: CUBETEXTURE_EMPTY.source.style,
    });
  }

  /**
   * Declares colour and depth writes on its camera's target, or on the scene's
   *
   * Declaring the depth too puts the sky on the same render target as the opaque draw that
   * follows, even though the draw never writes depth.
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.writeColor(b.targetColor);
    b.writeDepth(b.targetDepth);
  }

  /**
   * Skips the frame when the view has no background
   *
   * A skipped pass binds no target and draws nothing.
   * @param session - The current frame's render session
   * @returns Whether the view has a background to draw
   */
  public override condition(session: RenderSession): boolean {
    return session.view3d.background !== null;
  }

  /**
   * Draws the sky cube with the view's current background
   *
   * Recompiles its shader when the view's tone mapping has changed since the last draw.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    const { view3d } = session;
    const texture = view3d.background;
    if (!texture) return;

    // Recompile if the View's tone-mapping setting changed (or first frame).
    const toneBit = view3d._toneMappingBit;
    if (this._shader && this._cachedToneBit !== toneBit) {
      this._shader.destroy();
      this._shader = null;
    }
    if (!this._shader) {
      // The material system prepends the backend's global bit; we supply the
      // pass-specific bits, preserving the [global, background, tone] order.
      const bits: ShaderBit[] = toneBit ? [backgroundBit, toneBit] : [backgroundBit];
      this._shader = this.pipe.renderer.material3d.compilePassShader(bits, backgroundTemplate);
      this._cachedToneBit = toneBit;
    }

    this._backgroundBindGroup.setResource(texture.source, 0);
    this._backgroundBindGroup.setResource(texture.source.style, 1);

    // Bind groups: 0 = global, 1 = camera, 2 = background (cubemap).
    this._shader.groups[0] = session.globalBindGroup;
    this._shader.groups[1] = getCameraData(this.camera ?? view3d.camera).bindGroup;
    this._shader.groups[2] = this._backgroundBindGroup;

    this.pipe.renderGeometry(this._geometry, this._shader, this._state);
  }

  /** Releases the pass-owned shader, cube geometry, and bind group */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._shader?.destroy();
    this._shader = null;
    // Exclusively-owned background-cube geometry (single vertex buffer, no index); free its GPU
    // buffer too.
    this._geometry.destroy(true);
    // Detaches the bind group's change listeners and nulls its slots; the
    // user's background CubeTexture source bound here is shared, not destroyed.
    this._backgroundBindGroup.destroy();
  }
}
