import { definedProps, Geometry, Mesh, Shader } from 'pixi.js';
import type { DestroyOptions, MeshOptions, Texture } from 'pixi.js';

/**
 * Constructor options for {@link DepthMapViewer}
 *
 * Also takes pixi's `MeshOptions`, such as `label` and `position`, except `geometry` and `shader`,
 * which the viewer builds.
 * @example
 * ```ts
 * const viewer = new DepthMapViewer({ texture: depthArray, size: 384, position: { x: 8, y: 8 } });
 * app.stage.addChild(viewer);
 * ```
 * @category extras:debug
 * @advanced
 */
export interface DepthMapViewerOptions extends Omit<MeshOptions<Geometry, Shader>, 'geometry' | 'shader' | 'texture'> {
  /** Depth array texture to show */
  texture: Texture;
  /**
   * Width and height of the quad, in pixels
   * @default 256
   */
  size?: number;
}

/**
 * Debug quad that shows a depth array texture in greyscale
 *
 * Shows the first four layers in a 2×2 grid: layer 0 top-left, 1 top-right, 2 bottom-left and 3
 * bottom-right. Add it to the stage like any 2D mesh while debugging, then remove it.
 * @category extras:debug
 * @advanced
 */
export class DepthMapViewer extends Mesh<Geometry, Shader> {
  /**
   * Defaults for every new `DepthMapViewer`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * DepthMapViewer.defaultOptions.size = 512;
   * ```
   */
  public static defaultOptions: Partial<Omit<DepthMapViewerOptions, 'texture'>> = {
    size: 256,
  };

  /**
   * Builds the quad and the shader that reads `options.texture`
   * @param options - Options for the viewer
   */
  constructor(options: DepthMapViewerOptions) {
    const { texture, size, ...rest } = { ...DepthMapViewer.defaultOptions, ...definedProps(options) };
    const geometry = new Geometry({
      attributes: {
        aPosition: [0, 0, size!, 0, size!, size!, 0, size!],
        aUV: [0, 0, 1, 0, 1, 1, 0, 1],
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });

    const shader = Shader.from({
      gl: {
        vertex: `#version 300 es
        in vec2 aPosition;
        in vec2 aUV;
        uniform mat3 uProjectionMatrix;
        uniform mat3 uWorldTransformMatrix;
        uniform mat3 uTransformMatrix;
        out vec2 vUV;
        void main() {
            mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
            gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
            vUV = aUV;
        }
        `,
        fragment: `#version 300 es
        precision highp float;
        in vec2 vUV;
        uniform highp sampler2DArray uTexture;
        out vec4 fragColor;
        void main() {
            vec2 uv = vUV * 2.0;
            
            float layer = 0.0;

            if (vUV.x > 0.5) {
                uv.x -= 1.0;
                layer += 1.0;
            }

            if (vUV.y > 0.5) {
                uv.y -= 1.0;
                layer += 2.0;
            }

            float depth = texture(uTexture, vec3(uv, layer)).r;
            fragColor = vec4(vec3(depth), 1.0);
        }
        `,
      },
      gpu: {
        vertex: {
          entryPoint: 'mainVertex',
          source: /*wgsl*/ `
                        struct GlobalUniforms {
                            uProjectionMatrix : mat3x3<f32>,
                            uWorldTransformMatrix : mat3x3<f32>,
                            uWorldColorAlpha : vec4<f32>,
                            uResolution : vec2<f32>,
                        }

                        struct LocalUniforms {
                            uTransformMatrix : mat3x3<f32>,
                            uColor : vec4<f32>,
                            uRound : f32,
                        }

                        @group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
                        @group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

                        struct VertexInput {
                            @location(0) aPosition : vec2<f32>,
                            @location(1) aUV : vec2<f32>,
                        };

                        struct VertexOutput {
                            @builtin(position) position : vec4<f32>,
                            @location(0) vUV : vec2<f32>,
                        };

                        @vertex
                        fn mainVertex(input : VertexInput) -> VertexOutput {
                            var output : VertexOutput;
                            let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
                            output.position = vec4<f32>((mvp * vec3<f32>(input.aPosition, 1.0)).xy, 0.0, 1.0);
                            output.vUV = input.aUV;
                            return output;
                        }
                    `,
        },
        fragment: {
          entryPoint: 'mainFragment',
          source: /*wgsl*/ `
                        @group(2) @binding(0) var uTexture : texture_depth_2d_array;
                        @group(2) @binding(1) var uSampler : sampler;

                        @fragment
                        fn mainFragment(@location(0) vUV : vec2<f32>) -> @location(0) vec4<f32> {
                            var uv = vUV * 2.0;
                            var layer = 0;

                            if (vUV.x > 0.5) {
                                uv.x -= 1.0;
                                layer += 1;
                            }

                            if (vUV.y > 0.5) {
                                uv.y -= 1.0;
                                layer += 2;
                            }

                            let depth = textureSample(uTexture, uSampler, uv, layer);
                            return vec4<f32>(vec3<f32>(depth), 1.0);
                        }
                    `,
        },
      },
      resources: {
        uTexture: texture.source,
        uSampler: texture.source.style,
      },
    });

    super({ ...rest, texture, geometry, shader });

    const gpuProgram = this.shader?.gpuProgram;
    if (gpuProgram) {
      gpuProgram.gpuLayout[2][1].sampler!.type = 'non-filtering';
    }

    this.shader!.resources.uTexture = texture.source;
    this.shader!.resources.uSampler = texture.source.style;
  }

  /**
   * Frees the quad's GPU buffers; the next render uploads them again
   *
   * The shader holds no GPU memory of its own, since pixi caches compiled programs.
   */
  public override unload(): void {
    if (this.destroyed) return;

    super.unload();

    const { geometry } = this;
    for (const buffer of geometry.buffers) buffer.unload();
    geometry.unload();
  }

  /**
   * Destroys the viewer and the quad and shader it built
   *
   * As on any pixi `Mesh`, the viewed texture is destroyed only when `options` asks for it, and
   * `destroy(true)` destroys its source as well, so call `destroy()` when viewing a live shadow map.
   * @param options - Destroy options, as for pixi's `Mesh.destroy`
   */
  public override destroy(options?: DestroyOptions): void {
    if (this.destroyed) return;

    const { geometry, shader } = this;

    super.destroy(options);
    geometry.destroy(true);
    shader?.destroy();
  }
}
