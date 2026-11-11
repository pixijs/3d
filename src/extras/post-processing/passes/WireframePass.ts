import type { ColorSource } from 'pixi.js';
import { definedProps, State } from 'pixi.js';

import { MeshPass } from '../../../post-processing/passes/MeshPass';
import type { MeshPassOptions } from '../../../post-processing/passes/MeshPass';
import { solidMeshDescriptor } from './solidMeshShader';

/**
 * Constructor options for {@link WireframePass}
 * @example
 * ```ts
 * new WireframePass({ color: 0x00ff66, enabled: false });
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface WireframePassOptions extends Omit<MeshPassOptions, 'name' | 'descriptor'> {
  /**
   * Line colour
   * @default 0x00ff00
   * @example
   * ```ts
   * new WireframePass({ color: 0xff00ff });
   * ```
   */
  color?: ColorSource;
}

/**
 * Debug pass that redraws opted-in meshes as lines over their shaded result
 *
 * Add it to `View3D.passes`, and opt a mesh in with `passes: { wireframe: true }` on its material.
 * Depth testing is off, so edges on the far side of a mesh show through. By default it draws after
 * every scene draw, so the lines show over everything.
 *
 * The lines aren't an exact wireframe: the pass draws a mesh's triangle indices in pairs, so some
 * edges are missed and some lines join one triangle to the next. That's enough to inspect a mesh.
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
   * Defaults for every new `WireframePass`; an option passed as `undefined` keeps its default
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
      descriptor: {
        shaderDescriptor: solidMeshDescriptor({ color }),
        state,
        topology: 'line-list',
      },
    });
  }
}
