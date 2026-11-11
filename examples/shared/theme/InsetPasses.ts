/** A same-scene InsetView's second camera, its render texture, and the passes that draw the view's scene into it */

import { Camera3D, MeshPass } from '@pixi/3d';
import type { CameraMode, Pass3D, View3D } from '@pixi/3d';
import { RenderTexture } from 'pixi.js';

import { InsetSkyPass } from './InsetSkyPass';

/** Options for {@link InsetPasses} */
export interface InsetPassesOptions {
  /** The view whose scene it draws again */
  view3d: View3D;
  /** The camera's projection */
  mode: CameraMode;
  /** The name of the MeshPass that inset-only helpers draw in */
  pass: string;
  /** The render texture's size in px, and its pixels per px */
  width: number;
  height: number;
  resolution: number;
}

/**
 * A camera under a view's root that draws the view's scene again into a render texture of its own
 *
 * It appends four passes to `view3d.passes`: the view's sky from the camera, the opaque meshes, the MeshPass named
 * `pass` for the inset-only helpers (opaque, so they draw before the blended meshes), then the transparent meshes
 * sorted back to front like the view's own, so ghosts and wedges layer right. A corner `viewport` on the view's own
 * target won't do: a pass there never clears, so the picture would depth-test against the main view.
 * @example
 * ```ts
 * const passes = new InsetPasses({ view3d, mode: 'perspective', pass: 'inset', width: 320, height: 180, resolution });
 * const picture = new Sprite(passes.target);
 * ```
 */
export class InsetPasses {
  /** The second camera, under `view3d.root` */
  public readonly camera: Camera3D;
  /** What the camera draws into */
  public readonly target: RenderTexture;
  /** The view whose scene it draws */
  public readonly view3d: View3D;
  private readonly _resolution: number = 1;
  private readonly _passes: readonly Pass3D[];

  constructor({ view3d, mode, pass, width, height, resolution }: InsetPassesOptions) {
    // dynamic, so the sprite showing it follows a resize instead of stretching its old frame
    const target = RenderTexture.create({ width, height, resolution, dynamic: true });
    const camera = new Camera3D({ mode, fov: 40, renderTexture: target, parent: view3d.root });

    this._passes = [
      new InsetSkyPass(camera),
      new MeshPass({ name: 'opaque', camera }),
      new MeshPass({ name: pass, camera }),
      new MeshPass({ name: 'transparent', camera, sort: 'distance' }),
    ];
    view3d.passes = [...view3d.passes, ...this._passes];
    this._resolution = resolution;
    this.camera = camera;
    this.target = target;
    this.view3d = view3d;
  }

  /** Resizes the render texture to a picture of `width` × `height` px */
  public resize(width: number, height: number): void {
    this.target.resize(width, height, this._resolution);
  }

  /** Takes its passes out of the view and frees them, the camera and the render texture */
  public destroy(): void {
    const passes = this._passes;

    if (this.camera.destroyed) return;
    this.view3d.passes = this.view3d.passes.filter((pass) => !passes.includes(pass));
    for (const pass of passes) pass.destroy();
    this.camera.destroy();
    this.target.destroy(true);
  }
}
