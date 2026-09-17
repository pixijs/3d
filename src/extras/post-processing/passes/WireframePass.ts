import type { ColorSource } from 'pixi.js';
import { definedProps, State } from 'pixi.js';

import type { PassStage } from '../../../post-processing/Pass3D';
import { MeshPass } from '../../../post-processing/passes/MeshPass';
import type { MeshPassOptions } from '../../../post-processing/passes/MeshPass';
import { solidMeshDescriptor } from './solidMeshShader';

/**
 * Constructor options for {@link WireframePass}
 *
 * Every {@link MeshPassOptions} field except the ones the wireframe fixes: its `name` (materials opt in as
 * `wireframe`), its shader `descriptor`, and `textures`.
 * @example
 * ```ts
 * new WireframePass({ color: 0x00ff66, enabled: false });
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface WireframePassOptions extends Omit<MeshPassOptions, 'name' | 'descriptor' | 'textures'> {
  /**
   * Line colour
   * @default 0x00ff00
   */
  color?: ColorSource;
  /**
   * Where in the default graph the lines draw
   * @default 'afterTransparent'
   */
  stage?: Exclude<PassStage, 'post'>;
}

/**
 * Wireframe debug pass — redraws opted-in meshes as lines over their shaded result
 *
 * Add it to `View3D.passes`; meshes join by opting into the `wireframe` pass on their
 * material. Depth testing is off so the lines never z-fight the surface they trace. A
 * triangle-list index buffer drawn as lines yields triangle edges with 3x overdraw — fine for
 * inspection, not for production.
 * @example
 * ```ts
 * new View3D({ passes: [new WireframePass({ color: 0x00ff66 })] });
 * new Material3D({ passes: { wireframe: true } });
 * ```
 * @category extras:post-processing
 * @standard
 */
export class WireframePass extends MeshPass {
  /**
   * Default {@link WireframePassOptions} merged under every constructor call
   *
   * `new WireframePass(opts)` resolves as `{ ...WireframePass.defaultOptions, ...opts }`. Mutate to change defaults
   * process-wide.
   * @example
   * ```ts
   * WireframePass.defaultOptions.color = 0xff00ff;
   * ```
   */
  public static defaultOptions: WireframePassOptions = {
    color: 0x00ff00,
    stage: 'afterTransparent',
    description: 'Draws opted-in geometry as lines for wireframe inspection.',
  };

  constructor(options: WireframePassOptions = {}) {
    const { color, ...rest } = { ...WireframePass.defaultOptions, ...definedProps(options) };

    const state = new State();
    state.depthTest = false;
    state.culling = false;
    state.blend = false;

    super({
      ...rest,
      name: 'wireframe',
      textures: false,
      descriptor: {
        shaderDescriptor: solidMeshDescriptor({ color }),
        state,
        topology: 'line-list',
      },
    });
  }
}
