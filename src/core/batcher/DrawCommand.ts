import type { BindGroup, Geometry, Shader, State, Topology } from 'pixi.js';

import type { DrawCommandCapture } from './DrawCommandCapture';

/** @internal */
export class DrawCommand {
  public geometry: Geometry = null!;
  public shader: Shader = null!;
  public globalBindGroup: BindGroup = null!;
  /** The group bound at 2: a material's own, a merged run's, or `undefined` for a pass that binds no material */
  public batchBindGroup: BindGroup | undefined = undefined;
  public state: State = null!;
  public topology: Topology = null!;
  /** Held here, since the members may be re-keyed or destroyed before a draw list edits the command */
  public batchKey = 0;
  /** The id of the texture set {@link batchBindGroup} binds, or 0 for a pass that binds no material */
  public textureSetId = 0;
  public merged = false;
  /**
   * Whether every member has left; the command keeps its slot so no other command's args move, and
   * a bundle recorded since skips it, as its material may be destroyed
   */
  public dead = false;
  /** Whether a bundle recorded while the command was dead skipped it, so reviving it re-records the bundles */
  public leftOut = false;
  /** The captures a tail command holds while it has members; empty on a command the build recorded */
  public readonly captures: DrawCommandCapture[] = [];
}
