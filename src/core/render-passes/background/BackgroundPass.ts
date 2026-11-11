import { BindGroup, Color, CubeTexture, UniformGroup } from 'pixi.js';
import type { Geometry, Shader, State, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { writeLinearRgb } from '../../../materials/BaseMaterial3D';
import type { Camera3D } from '../../../scene/cameras/Camera3D';
import { getCameraData } from '../../CameraData';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { SceneOutput } from '../../render-graph/SceneOutput';
import { decodeToLinearBit, isLinearFormat } from '../../shader/bits/decodeToLinearBit';
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

/** Vertex stage of both sky templates; `backgroundVertexGl` in `backgroundPassUtils.ts` is its GLSL twin */
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

/** The cube sky's template; `backgroundGlTemplate` in `backgroundPassUtils.ts` is its GLSL half */
const backgroundTemplate: ShaderBitTemplate = {
  bindGroups: [{ name: 'global', ubo: true }, 'camera', 'background'],
  gpu: /* wgsl */ `
{{header}}
${backgroundVertexWgsl}
@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  let sample = textureSample(uCube, uCubeSampler, normalize(input.vDir));
  let sampleLinear = decodeToLinear(sample.rgb);
  var finalColor = sampleLinear * global.uExposure;
  {{fragmentEnd}}
  return vec4<f32>(finalColor, sample.a);
}
`,
  gl: backgroundGlTemplate,
};

/** The gradient sky's template; `backgroundGradientGlTemplate` in `backgroundPassUtils.ts` is its GLSL half */
const backgroundGradientTemplate: ShaderBitTemplate = {
  bindGroups: [{ name: 'global', ubo: true }, 'camera', 'background'],
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
  /** Camera to draw the sky from, or the view's own when omitted; see {@link RenderPassOptions#camera} */
  camera?: Camera3D;
  /** The scene outputs attached after the target colour; see {@link RenderPassOptions#attachedOutputs} */
  attachedOutputs?: readonly SceneOutput[];
}

/**
 * Draws the view's {@link View3D#background} behind the scene: a cubemap, a {@link Hemisphere}
 * sky/ground gradient, or a plain colour
 *
 * The sky stays at infinity however the camera moves, and takes the view's {@link View3D#exposure}
 * and {@link View3D#toneMapping}, so it matches materials that reflect the same environment. Fog in
 * the same colour as a plain colour background blends into it exactly. Switching between a cubemap
 * and a hemisphere or colour recompiles the pass's shader. The pass holds the old cubemap until a
 * frame draws another background, which a `null` background never does; destroying the cubemap
 * before then makes pixi warn.
 *
 * It paints colour over whatever its target holds, with no depth test, so add it before its
 * camera's opaque draw. The default graph draws one for the view's camera; any other camera draws
 * no sky unless you add a `BackgroundPass` with that `camera` from a {@link Pass3D#build}.
 * @category rendering
 * @advanced
 */
export class BackgroundPass extends RenderPass {
  private readonly _geometry: Geometry;
  private readonly _state: State;
  private readonly _cubeBindGroup: BindGroup;
  private readonly _skyColor = new Float32Array(3);
  private readonly _groundColor = new Float32Array(3);
  private readonly _up = new Float32Array(3);
  private readonly _gradientUniforms: UniformGroup;
  private readonly _gradientBindGroup: BindGroup;
  private _shader: Shader | null = null;
  private _cachedToneBit: ShaderBit | null = null;
  private _cachedBackgroundBit: ShaderBit | null = null;
  private _cachedDecodeBit: ShaderBit | null = null;
  private _destroyed = false;

  constructor(options: BackgroundPassOptions) {
    super({
      renderer: options.renderer,
      name: 'background',
      description: 'Draws the View3D cubemap, hemisphere or colour background behind scene geometry.',
      bit: RenderPassBit.BACKGROUND,
      camera: options.camera,
      attachedOutputs: options.attachedOutputs,
    });
    this._geometry = createBackgroundGeometry();
    this._state = createBackgroundState();
    this._cubeBindGroup = new BindGroup({
      uCube: CUBETEXTURE_EMPTY.source,
      uCubeSampler: CUBETEXTURE_EMPTY.source.style,
    });
    this._gradientUniforms = new UniformGroup({
      uSkyColor: { value: this._skyColor, type: 'vec3<f32>' },
      uGroundColor: { value: this._groundColor, type: 'vec3<f32>' },
      uUp: { value: this._up, type: 'vec3<f32>' },
    });
    this._gradientBindGroup = new BindGroup({ background: this._gradientUniforms });
  }

  /**
   * Declares colour and depth writes on its camera's target, or on the scene's
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    this._writeTarget(b);
  }

  /**
   * Skips the frame when the view has no background
   * @param session - The current frame's render session
   * @returns Whether the view has a background to draw
   */
  public override condition(session: RenderSession): boolean {
    return session.view3d.background !== null;
  }

  /**
   * Draws the sky with the view's current background
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    const { view3d } = session;
    const background = view3d.background;
    if (background === null) return;

    let bit: ShaderBit;
    let template: ShaderBitTemplate;
    let backgroundGroup: BindGroup;
    let decodeBit: ShaderBit | null = null;
    if (background instanceof CubeTexture) {
      bit = backgroundBit;
      decodeBit = decodeToLinearBit(!isLinearFormat(background.source.format));
      template = backgroundTemplate;
      this._cubeBindGroup.setResource(background.source, 'uCube');
      this._cubeBindGroup.setResource(background.source.style, 'uCubeSampler');
      backgroundGroup = this._cubeBindGroup;
    } else {
      bit = backgroundGradientBit;
      template = backgroundGradientTemplate;
      if (typeof background === 'number') {
        writeLinearRgb(this._skyColor, 0, Color.shared.setValue(background));
        this._groundColor.set(this._skyColor);
        this._up.fill(0);
      } else {
        writeHemisphere(background, this._skyColor, this._groundColor, this._up);
      }
      backgroundGroup = this._gradientBindGroup;
    }

    const toneBit = view3d._toneMappingBit;
    if (
      this._shader &&
      (this._cachedToneBit !== toneBit || this._cachedBackgroundBit !== bit || this._cachedDecodeBit !== decodeBit)
    ) {
      this._shader.destroy();
      this._shader = null;
    }
    if (!this._shader) {
      const bits: ShaderBit[] = [bit];
      if (decodeBit) bits.push(decodeBit);
      if (toneBit) bits.push(toneBit);
      this._shader = this.pipe.renderer.material3d.compilePassShader(bits, template);
      this._cachedToneBit = toneBit;
      this._cachedBackgroundBit = bit;
      this._cachedDecodeBit = decodeBit;
      if (bit === backgroundGradientBit) {
        this._cubeBindGroup.setResource(CUBETEXTURE_EMPTY.source, 'uCube');
        this._cubeBindGroup.setResource(CUBETEXTURE_EMPTY.source.style, 'uCubeSampler');
      }
    }

    this._shader.groups[0] = session.globalBindGroup;
    this._shader.groups[1] = getCameraData(this.camera ?? view3d.camera).bindGroup;
    this._shader.groups[2] = backgroundGroup;

    this.pipe.renderGeometry(this._geometry, this._shader, this._state);
  }

  /** Frees the gradient's uniform buffer on the GPU; the next frame drawing a hemisphere or colour uploads it again */
  public unload(): void {
    this._gradientUniforms.buffer?.unload();
  }

  /** Releases the pass's shader, sky cube, bind groups and uniform buffer; the view's background texture stays alive */
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
