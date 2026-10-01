import { BindGroup, Texture } from 'pixi.js';
import type { Shader, State, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { getCameraData } from '../../CameraData';
import { fullscreenTriangleGeometry } from '../../fullscreenTriangleGeometry';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ColorHandle } from '../../render-graph/ResourceHandle';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';
import { createOutputState, outputBit, outputGlTemplate } from './outputPassUtils';

/**
 * The output blit's shader template, in WGSL here and GLSL in {@link outputGlTemplate}
 *
 * Both halves draw the fullscreen triangle and sample the scene colour texture. The pooled texture
 * can be larger than the scene, which fills only the part `uViewportUVScale` marks out, so the
 * `[0, 1]` blit UV is scaled onto that part; the scale is `(1, 1)` when the two match. The WGSL UV
 * flips Y for WebGPU's top-left texture origin, and the GLSL one doesn't, since a WebGL render
 * target's origin is at the bottom left.
 *
 * `render` fills the groups `bindGroups` lists: 0 global, which the blit doesn't read but the
 * layout includes, 1 the view camera, whose `uViewportUVScale` it reads, and 2 the output texture.
 */
const outputTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'output'],
  gpu: /* wgsl */ `
{{header}}

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
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
  /** The scene colour texture to present: `graph.sceneColor` */
  source: ColorHandle;
}

/**
 * Draws the composited scene colour onto the view's rect on screen with a fullscreen triangle
 *
 * `createDefaultGraph3D` adds it when the view composites and has no post effects; with effects,
 * the last effect draws to the screen instead. The blit blends over any 2D content already on the
 * target. One class serves both backends through the `View3DPipe` interface.
 * @internal
 */
export class OutputPass extends RenderPass {
  private readonly _state: State;
  private readonly _bindGroup: BindGroup;
  private _shader: Shader | null = null;
  private _destroyed = false;
  private readonly _source: ColorHandle;

  constructor(options: OutputPassOptions) {
    super({
      renderer: options.renderer,
      name: 'output',
      description: 'Composites the View3D scene color into the active Pixi render target.',
      bit: RenderPassBit.NONE,
    });
    this._source = options.source;
    this._state = createOutputState();
    this._bindGroup = new BindGroup({
      0: Texture.WHITE.source,
      1: Texture.WHITE.source.style,
    });
  }

  /**
   * Declares a read of the scene colour, which keeps it alive through this pass, and writes to the
   * view's own colour and depth, which put the pass on the screen at the view's rect
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.read(this._source);
    b.writeColor(b.defaultColor);
    b.writeDepth(b.defaultDepth);
  }

  /**
   * Blits the scene colour onto the view's rect on screen
   *
   * The bind group starts out holding a placeholder, and gets this frame's scene texture here.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    if (!this._shader) {
      this._shader = this.pipe.renderer.material3d.compilePassShader([outputBit], outputTemplate);
    }

    const texture = session.view3d._graph._texture(this._source, session);
    this._bindGroup.setResource(texture.source, 0);
    this._bindGroup.setResource(texture.source.style, 1);

    this._shader.groups[0] = session.globalBindGroup;
    this._shader.groups[1] = getCameraData(session.view3d.camera).bindGroup;
    this._shader.groups[2] = this._bindGroup;

    this.pipe.renderGeometry(fullscreenTriangleGeometry(), this._shader, this._state);
  }

  /** Releases the pass-owned shader and bind group */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._shader?.destroy();
    this._shader = null;
    this._bindGroup.destroy();
  }
}
