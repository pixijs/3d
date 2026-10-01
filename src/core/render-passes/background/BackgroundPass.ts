import { BindGroup, CubeTexture, UniformGroup } from 'pixi.js';
import type { Geometry, Shader, State, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import { getCameraData } from '../../CameraData';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import { CUBETEXTURE_EMPTY } from '../../textures/DefaultTextures';
import { writeHemisphere } from '../../writeHemisphere';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';
import {
  backgroundBit,
  backgroundGlTemplate,
  backgroundGradientBit,
  backgroundGradientGlTemplate,
  createBackgroundGeometry,
  createBackgroundState,
} from './backgroundPassUtils';

/**
 * WGSL vertex stage shared by the cube and gradient templates; `backgroundVertexGl` is its GLSL twin
 *
 * The cube's vertex position is already the world direction to look up, so the shader doesn't
 * rotate it again. The view matrix loses its translation, which keeps the sky at infinity, and the
 * vertex is written with `z = w`, on the far plane, so neither clipping plane cuts the cube
 * whatever the camera's `near` and `far`.
 */
const backgroundVertexWgsl = /* wgsl */ `
@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  output.vDir = input.aPosition;

  var view = camera.uViewMatrix;
  view[3] = vec4<f32>(0.0, 0.0, 0.0, view[3].w);

  let clip = camera.uProjectionMatrix * view * vec4<f32>(input.aPosition, 1.0);
  output.position = vec4<f32>(clip.x, clip.y, clip.w, clip.w);

  return output;
}
`;

/**
 * The cube sky's shader template, in WGSL here and GLSL in {@link backgroundGlTemplate}
 *
 * Each backend's `compilePassShader` reads its own half and puts the global and camera bits first,
 * so `render` adds the background bit and the view's tone-mapping bit after them, and fills the
 * groups `bindGroups` lists: 0 global, 1 camera, 2 background. The fragment decodes the cubemap's
 * sRGB with a 2.2 gamma and scales it by the view's exposure; the tone-mapping bit then applies the
 * matching 1/2.2 encode.
 */
const backgroundTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'background'],
  gpu: /* wgsl */ `
{{header}}
${backgroundVertexWgsl}
@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  let sample = textureSample(uCube, uCubeSampler, normalize(input.vDir));
  let sampleLinear = pow(sample.rgb, vec3<f32>(2.2));
  var finalColor = sampleLinear * global.uExposure;
  {{fragmentEnd}}
  return vec4<f32>(finalColor, sample.a);
}
`,
  gl: backgroundGlTemplate,
};

/**
 * The {@link Hemisphere} gradient sky's shader template, in WGSL here and GLSL in
 * {@link backgroundGradientGlTemplate}
 *
 * Same vertex stage and bind groups as the cube template. The fragment draws the gradient that
 * materials get from a hemisphere environment (`envSourceHemisphereBit`), scaled by the view's
 * exposure.
 */
const backgroundGradientTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'background'],
  gpu: /* wgsl */ `
{{header}}
${backgroundVertexWgsl}
@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  let t = dot(normalize(input.vDir), background.uUp) * 0.5 + 0.5;
  var finalColor = mix(background.uGroundColor, background.uSkyColor, t) * global.uExposure;
  {{fragmentEnd}}
  return vec4<f32>(finalColor, 1.0);
}
`,
  gl: backgroundGradientGlTemplate,
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
 * Draws the view's {@link View3D#background} behind the scene: a cubemap, or a {@link Hemisphere}
 * sky/ground gradient
 *
 * The sky is a cube around the camera with the camera's translation removed, so it stays at
 * infinity however the camera moves. It runs the view's {@link View3D#exposure} and
 * {@link View3D#toneMapping} curve, so it matches the materials that reflect the same
 * environment. The pass skips any frame where the view has no background.
 *
 * With a hemisphere, the pass draws the gradient described on {@link Hemisphere} for each view
 * direction, the same one materials receive when that object is the environment. It converts the
 * hemisphere's fields into its own uniforms every frame, so the background does not depend on
 * the view's environment.
 *
 * The pass holds one shader. Swapping between a cubemap and a hemisphere recompiles it. A swap to
 * a hemisphere also unbinds the old cubemap, so destroying that cubemap raises no pixi warning.
 * `unload` frees the gradient's uniform buffer, and the next frame that draws a hemisphere
 * uploads it again.
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
  private readonly _cubeBindGroup: BindGroup;
  /** Linear sky colour scaled by intensity, the `uSkyColor` lane */
  private readonly _skyColor = new Float32Array(3);
  /** Linear ground colour scaled by intensity, the `uGroundColor` lane */
  private readonly _groundColor = new Float32Array(3);
  /** Unit up axis, or zeros for a zero-length one, the `uUp` lane */
  private readonly _up = new Float32Array(3);
  private readonly _gradientUniforms: UniformGroup;
  private readonly _gradientBindGroup: BindGroup;
  private _shader: Shader | null = null;
  /** Tone-map bit baked into `_shader`, compared each frame to catch a change on the view */
  private _cachedToneBit: ShaderBit | null = null;
  /** Background bit baked into `_shader`: cube or gradient */
  private _cachedBackgroundBit: ShaderBit | null = null;
  private _destroyed = false;

  constructor(options: BackgroundPassOptions) {
    super({
      renderer: options.renderer,
      name: 'background',
      description: 'Draws the View3D cubemap or hemisphere background behind scene geometry.',
      bit: RenderPassBit.BACKGROUND,
      camera: options.camera,
    });
    this._geometry = createBackgroundGeometry();
    this._state = createBackgroundState();
    this._cubeBindGroup = new BindGroup({
      0: CUBETEXTURE_EMPTY.source,
      1: CUBETEXTURE_EMPTY.source.style,
    });
    this._gradientUniforms = new UniformGroup({
      uSkyColor: { value: this._skyColor, type: 'vec3<f32>' },
      uGroundColor: { value: this._groundColor, type: 'vec3<f32>' },
      uUp: { value: this._up, type: 'vec3<f32>' },
    });
    this._gradientBindGroup = new BindGroup({ 0: this._gradientUniforms });
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
   * @returns Whether the view has a cubemap or hemisphere background to draw
   */
  public override condition(session: RenderSession): boolean {
    return session.view3d.background !== null;
  }

  /**
   * Draws the sky cube with the view's current background
   *
   * Picks the cubemap or gradient variant, then recompiles the shader if the variant or the view's
   * tone mapping changed since the last draw. Moving to the gradient also points the cube bind group
   * back at the empty cubemap, so the old cubemap isn't left bound and destroying it raises no pixi
   * warning.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    const { view3d } = session;
    const background = view3d.background;
    if (!background) return;

    let bit: ShaderBit;
    let template: ShaderBitTemplate;
    let backgroundGroup: BindGroup;
    if (background instanceof CubeTexture) {
      bit = backgroundBit;
      template = backgroundTemplate;
      this._cubeBindGroup.setResource(background.source, 0);
      this._cubeBindGroup.setResource(background.source.style, 1);
      backgroundGroup = this._cubeBindGroup;
    } else {
      bit = backgroundGradientBit;
      template = backgroundGradientTemplate;
      writeHemisphere(background, this._skyColor, this._groundColor, this._up);
      backgroundGroup = this._gradientBindGroup;
    }

    const toneBit = view3d._toneMappingBit;
    if (this._shader && (this._cachedToneBit !== toneBit || this._cachedBackgroundBit !== bit)) {
      this._shader.destroy();
      this._shader = null;
    }
    if (!this._shader) {
      const bits: ShaderBit[] = toneBit ? [bit, toneBit] : [bit];
      this._shader = this.pipe.renderer.material3d.compilePassShader(bits, template);
      this._cachedToneBit = toneBit;
      this._cachedBackgroundBit = bit;
      if (bit === backgroundGradientBit) {
        this._cubeBindGroup.setResource(CUBETEXTURE_EMPTY.source, 0);
        this._cubeBindGroup.setResource(CUBETEXTURE_EMPTY.source.style, 1);
      }
    }

    this._shader.groups[0] = session.globalBindGroup;
    this._shader.groups[1] = getCameraData(this.camera ?? view3d.camera).bindGroup;
    this._shader.groups[2] = backgroundGroup;

    this.pipe.renderGeometry(this._geometry, this._shader, this._state);
  }

  /**
   * Frees the gradient's uniform buffer on the GPU
   *
   * The next frame that draws a hemisphere uploads it again. {@link RenderGraph#unload} calls
   * this. Idempotent.
   */
  public unload(): void {
    this._gradientUniforms.buffer?.unload();
  }

  /**
   * Releases the pass's shader, its sky cube with the cube's vertex buffer, its bind groups and the
   * gradient's uniform buffer
   *
   * The view's background texture stays alive: the cube bind group only pointed at it. The gradient
   * bind group goes first, so it lets go of the uniform group before the buffer under it is freed.
   */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._shader?.destroy();
    this._shader = null;
    this._geometry.destroy(true);
    this._cubeBindGroup.destroy();
    this._gradientBindGroup.destroy();
    this._gradientUniforms.buffer?.destroy();
  }
}
