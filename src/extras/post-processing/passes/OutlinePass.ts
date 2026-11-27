import type { ColorSource } from 'pixi.js';
import { definedProps, State } from 'pixi.js';

import { MeshPass } from '../../../post-processing/passes/MeshPass';
import type { MeshPassOptions } from '../../../post-processing/passes/MeshPass';
import { solidMeshDescriptor } from './solidMeshShader';

/**
 * Constructor options for {@link OutlinePass}
 * @example
 * ```ts
 * new OutlinePass({ width: 0.05, color: 0x1a0f33, stage: 'afterTransparent' });
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface OutlinePassOptions extends Omit<MeshPassOptions, 'name' | 'descriptor'> {
  /**
   * How far each vertex is pushed out along its normal, in the mesh's local units
   *
   * A scaled mesh gets a scaled outline. Where a mesh splits its normals at a hard edge, as a cube
   * does, the outline has gaps at those edges.
   * @default 0.03
   * @example
   * ```ts
   * new OutlinePass({ width: 0.05 });
   * ```
   */
  width?: number;
  /**
   * Outline colour
   * @default 0x000000
   * @example
   * ```ts
   * new OutlinePass({ color: 0x1a0f33 });
   * ```
   */
  color?: ColorSource;
}

/**
 * Draws an ink outline around opted-in meshes, for a toon look
 *
 * The view half of a toon look: add it to `View3D.passes`, and meshes join by opting into the
 * `outline` pass on their material (`passes: { outline: true }`). The shell is drawn at the
 * `'shape'` level, so it follows skinning, morph targets, the mesh's billboard mode and the
 * material's bits that set `level: 'shape'`.
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
   * Defaults for every new `OutlinePass`; an option passed as `undefined` keeps its default
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

    const state = new State();
    state.depthTest = true;
    state.culling = true;
    state.clockwiseFrontFace = true;
    state.blend = false;

    super({
      ...rest,
      name: 'outline',
      level: 'shape',
      descriptor: {
        shaderDescriptor: solidMeshDescriptor({ color, extrude: width }),
        state,
      },
    });
  }
}
