import { BindGroup, Texture } from 'pixi.js';
import type { Geometry, Shader, State, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { getCameraData } from '../../CameraData';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ColorHandle } from '../../render-graph/ResourceHandle';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';
import { createOutputGeometry, createOutputState, outputBit, outputGlTemplate } from './outputPassUtils';

/**
 * Shader template for the output (present) pass — WGSL + GLSL
 *
 * Samples the scene-colour transient and writes it to the View's default (screen)
 * target. The WGSL UV flips Y for WebGPU's top-left texture origin; see outputGlTemplate.
 */
const outputTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'output'],
  gpu: /* wgsl */ `
{{header}}

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
  // The scene fills only the [0, vp] sub-rect of its pooled power-of-two texture;
  // scale the [0,1] blit UV onto that sub-rect (uViewportUVScale is 1 full-screen).
  let uv = vec2<f32>(input.aPosition.x * 0.5 + 0.5, 1.0 - (input.aPosition.y * 0.5 + 0.5));
  output.vUv = uv * camera.uViewportUVScale;
  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uTextureSampler, input.vUv);
}
`,
  gl: outputGlTemplate,
};

/**
 * Options for constructing an {@link OutputPass}
 * @internal
 */
interface OutputPassOptions {
  /** The renderer this pass will draw with */
  renderer: WebGLRenderer | WebGPURenderer;
  /** The scene colour transient to present — `graph.sceneColor` in composite mode */
  source: ColorHandle;
}

/**
 * Composites the scene-colour transient onto the View's default (screen) target with a
 * fullscreen-triangle blit
 *
 * Added to the graph only in `composite` mode (see `createDefaultGraph3D`). Declaring
 * the default colour + depth write resolves the pass to the screen target, so the
 * executor binds the View's on-canvas frame and the triangle lands there; `blend` composites it
 * over any 2D content already on the target.
 *
 * One class for both backends — programs against the `View3DPipe` interface (shader via
 * `compilePassShader`, draw via `renderGeometry`).
 * @internal
 */
export class OutputPass extends RenderPass {
  private readonly _geometry: Geometry;
  private readonly _state: State;
  private readonly _bindGroup: BindGroup;
  private _shader: Shader | null = null;
  private _destroyed = false;
  /** Scene-colour handle this pass presents; resolved to its texture in `render()` */
  private readonly _source: ColorHandle;

  constructor(options: OutputPassOptions) {
    super({
      renderer: options.renderer,
      name: 'output',
      description: 'Composites the View3D scene color into the active Pixi render target.',
      bit: RenderPassBit.NONE,
    });
    this._source = options.source;
    this._geometry = createOutputGeometry();
    this._state = createOutputState();
    // Placeholder texture; render() rebinds the live scene transient each frame.
    this._bindGroup = new BindGroup({
      0: Texture.WHITE.source,
      1: Texture.WHITE.source.style,
    });
  }

  /**
   * Declares the scene-colour read and the default colour + depth writes that resolve this pass to the screen
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    // Read the scene buffer (keeps it live through this pass) and write the View's
    // default colour + depth — that resolves the pass to the screen target, which
    // the executor binds at the View's clipped on-canvas rect.
    b.read(this._source);
    b.writeColor(b.defaultColor);
    b.writeDepth(b.defaultDepth);
  }

  /**
   * Blits the scene transient onto the screen rect with the fullscreen triangle
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    if (!this._shader) {
      this._shader = this.pipe.renderer.material3d.compilePassShader([outputBit], outputTemplate);
    }

    const texture = session.view3d._graph._texture(this._source, session);
    this._bindGroup.setResource(texture.source, 0);
    this._bindGroup.setResource(texture.source.style, 1);

    // Bind groups: 0 = global (unused by the blit but part of the layout), 1 = the view
    // camera (its `uViewportUVScale` is what maps the blit onto the scene transient's
    // sub-rect), 2 = output.
    this._shader.groups[0] = session.globalBindGroup;
    this._shader.groups[1] = getCameraData(session.view3d.camera).bindGroup;
    this._shader.groups[2] = this._bindGroup;

    this.pipe.renderGeometry(this._geometry, this._shader, this._state);
  }

  /** Releases the pass-owned shader, triangle geometry, and bind group */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._shader?.destroy();
    this._shader = null;
    this._geometry.destroy(true);
    this._bindGroup.destroy();
  }
}
