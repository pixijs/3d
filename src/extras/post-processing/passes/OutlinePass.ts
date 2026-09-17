import type { ColorSource } from 'pixi.js';
import { definedProps, State } from 'pixi.js';

import { MeshPass } from '../../../post-processing/passes/MeshPass';
import type { MeshPassOptions } from '../../../post-processing/passes/MeshPass';
import { solidMeshDescriptor } from './solidMeshShader';

/**
 * Constructor options for {@link OutlinePass}
 *
 * Every {@link MeshPassOptions} field except the ones the outline fixes: its `name` (materials opt in as
 * `outline`), its shader `descriptor`, and `textures`.
 * @example
 * ```ts
 * new OutlinePass({ width: 0.05, color: 0x1a0f33, stage: 'afterTransparent' });
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface OutlinePassOptions extends Omit<MeshPassOptions, 'name' | 'descriptor' | 'textures'> {
  /**
   * How far each vertex is pushed out along its normal, in the mesh's local units
   * @default 0.03
   */
  width?: number;
  /**
   * Ink colour
   * @default 0x000000
   */
  color?: ColorSource;
}

/**
 * Inverted-hull outline — redraws opted-in meshes as an extruded, back-face-only shell
 *
 * The view half of a toon look: add it to `View3D.passes`, and meshes join by opting
 * into the `outline` pass on their material (`passes: { outline: true }`). One class for
 * both backends; skinned and morphed meshes outline correctly because the draw is the
 * engine's forward path.
 * @example
 * ```ts
 * new View3D({ passes: [new OutlinePass({ width: 0.05 })] });
 * new Material3D({ baseColor: 0xff7733, passes: { outline: true } });
 * ```
 * @category extras:post-processing
 * @standard
 */
export class OutlinePass extends MeshPass {
  /**
   * Default {@link OutlinePassOptions} merged under every constructor call
   *
   * `new OutlinePass(opts)` resolves as `{ ...OutlinePass.defaultOptions, ...opts }`. Mutate to change defaults
   * process-wide.
   * @example
   * ```ts
   * OutlinePass.defaultOptions.width = 0.05;
   * ```
   */
  public static defaultOptions: OutlinePassOptions = {
    width: 0.03,
    color: 0x000000,
    stage: 'afterOpaque',
    description: 'Draws expanded back faces around opted-in meshes as an ink outline.',
  };

  constructor(options: OutlinePassOptions = {}) {
    const { width, color, ...rest } = { ...OutlinePass.defaultOptions, ...definedProps(options) };

    // Front faces culled: only the extruded back faces survive, which is the whole trick.
    const state = new State();
    state.depthTest = true;
    state.culling = true;
    state.clockwiseFrontFace = true;
    state.blend = false;

    super({
      ...rest,
      name: 'outline',
      textures: false,
      descriptor: {
        shaderDescriptor: solidMeshDescriptor({ color, extrude: width }),
        state,
      },
    });
  }
}
