import { BindGroup, CLEAR, Rectangle, State, Texture, UniformGroup } from 'pixi.js';
import type { BindOptions, Shader, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { ToneMapping } from '../../../scene/View3D';
import { fullscreenTriangleGeometry } from '../../fullscreenTriangleGeometry';
import type { DrawTarget } from '../../render-graph/RenderGraph';
import { toneOutputBits } from '../../shader/bits/tonemapping/toneMappingBits';
import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { View3DPipe } from '../../View3DPipe';

const scratchBind: BindOptions = { target: null!, clear: CLEAR.NONE };
const scratchViewport = new Rectangle();

const colorOutputBit: ShaderBit = {
  name: 'colorOutputDraw',
  attributes: {
    aPosition: 'float32x2',
  },
  bindings: {
    local: {
      uSource: 'texture_2d<f32>',
      uOffset: 'vec2<f32>',
    },
  },
};

/**
 * Reads by pixel position, not UV, so each texel lands where `copyColor` would put it on both
 * backends, as `View3DPipe.outputColor` promises
 */
const colorOutputTemplate: ShaderBitTemplate = {
  bindGroups: ['local'],
  gpu: /* wgsl */ `
{{header}}

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  let fxColor = textureLoad(uSource, vec2<i32>(input.position.xy + local.uOffset), 0);
  var finalColor = fxColor.rgb;
  {{fragmentEnd}}
  return vec4<f32>(finalColor, fxColor.a);
}
`,
  gl: {
    vertex: /* glsl */ `#version 300 es

{{header}}

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,
    fragment: /* glsl */ `#version 300 es

{{header}}

out vec4 fragColor;

void main() {
  vec4 fxColor = texelFetch(uSource, ivec2(gl_FragCoord.xy + uOffset), 0);
  vec3 finalColor = fxColor.rgb;
  {{end}}
  fragColor = vec4(finalColor, fxColor.a);
}
`,
  },
};

/** @internal */
export class ColorOutputDraw {
  private readonly _renderer: WebGPURenderer | WebGLRenderer;
  private readonly _uniforms = new UniformGroup({ uOffset: { value: new Float32Array(2), type: 'vec2<f32>' } });
  private readonly _bindGroup: BindGroup;
  private readonly _shaders = new Map<ToneMapping | null, Shader>();
  private readonly _state: State;

  constructor(renderer: WebGPURenderer | WebGLRenderer) {
    this._renderer = renderer;
    this._bindGroup = new BindGroup({ local: this._uniforms, uSource: Texture.WHITE.source });
    const state = new State();
    state.blend = false;
    state.depthTest = false;
    state.depthMask = false;
    state.culling = false;
    this._state = state;
  }

  /**
   * Clears only a `noFrame` dest, sparing tile GPUs a read-back; a clear would wipe the rest of a framed one's texture
   *
   * Puts the placeholder back after, so the bind group never keeps a pooled texture the pool may destroy.
   * @param pipe - The pipe drawing it
   * @param source - The camera's draw target and its content rect, in physical pixels
   * @param dest - The texture to fill
   * @param toneMapping - The tone mapping to apply, or `null` to change the format only
   */
  public draw(pipe: View3DPipe, source: DrawTarget, dest: Texture, toneMapping: ToneMapping | null): void {
    const renderer = this._renderer;
    const { viewport } = source;
    const frame = dest.frame;
    const resolution = dest.source.resolution;
    const x = Math.round(frame.x * resolution);
    const y = Math.round(frame.y * resolution);

    const offset = this._uniforms.uniforms.uOffset as Float32Array;
    offset[0] = viewport.x - x;
    offset[1] = viewport.y - y;
    this._uniforms.update();
    const ubo =
      'uniformBatch' in renderer.renderPipes
        ? renderer.renderPipes.uniformBatch.getUboResource(this._uniforms)
        : this._uniforms;
    this._bindGroup.setResource(ubo, 'local');
    this._bindGroup.setResource(source.target.colorTexture, 'uSource');

    let shader = this._shaders.get(toneMapping);
    if (!shader) {
      shader = renderer.material3d.compileIsolatedShader(
        [colorOutputBit, ...toneOutputBits(toneMapping)],
        colorOutputTemplate,
        {
          0: this._bindGroup,
        },
      );
      this._shaders.set(toneMapping, shader);
    }

    scratchBind.target = dest;
    scratchBind.clear = dest.noFrame ? CLEAR.COLOR : CLEAR.NONE;
    renderer.renderTarget.bind(scratchBind);
    scratchBind.target = null!;
    pipe.setViewport(scratchViewport.set(x, y, viewport.width, viewport.height));
    pipe.renderGeometry(fullscreenTriangleGeometry(), shader, this._state);
    this._bindGroup.setResource(Texture.WHITE.source, 'uSource');
  }

  public destroy(): void {
    for (const shader of this._shaders.values()) shader.destroy();
    (this._shaders as Map<ToneMapping | null, Shader> | null) = null;
    this._bindGroup.destroy();
  }
}
