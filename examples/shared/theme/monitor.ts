/**
 * A clay monitor: a bezel round a screen that shows any material, so any texture: a `ContainerTexture`, a camera's
 * render texture, a video
 *
 * Just the screen and its frame, no stand, so it floats like the logo or hangs on whatever the scene gives it.
 */

import { Container3D, Mesh3D, PlaneGeometry } from '@pixi/3d';
import type { BaseMaterial3D } from '@pixi/3d';
import type { Size } from 'pixi.js';

import { clayMaterial } from './clay';
import type { ClayColor } from './palette';
import { roundedBox } from './shapes';

/** The bezel's rim round the screen and its depth, as shares of the screen's width, so any size keeps the look */
const RIM = 0.045;
const DEPTH = 0.07;
/** How far the screen stands off the bezel's face, as a share of the width, so the two never fight for depth */
const GAP = 0.002;

export interface MonitorOptions {
  /** What the screen shows, e.g. `new FlatMaterial({ baseColorTexture, fog: false })` for a powered screen */
  material: BaseMaterial3D;
  /** The screen's width in world units; the bezel adds its rim round it. @default 3 */
  width?: number;
  /** The screen's width over its height; pass the texture's, so the picture keeps its shape. @default 16 / 9 */
  aspect?: number;
  /** Puts v = 0 on the top edge, for a texture stored top row first: a video, a render texture. @default false */
  flipV?: boolean;
  /** The bezel's clay. @default 'lilac' */
  color?: ClayColor | number;
}

export interface Monitor {
  /** The bezel and the screen, with its origin at the screen's centre: position and turn this */
  readonly root: Container3D;
  /** The screen, a plane facing +z through the root's origin; swap its `material` to show something else */
  readonly screen: Mesh3D;
  /** The clay frame round and behind the screen, which casts the monitor's shadow */
  readonly bezel: Mesh3D;
  /** The screen's size in world units, without the rim */
  readonly size: Readonly<Size>;
  /** Destroys the nodes and the geometry the monitor built; the screen's material stays yours */
  destroy(): void;
}

/**
 * Builds a monitor round a screen `width` wide and `width / aspect` tall
 * @example
 * ```ts
 * const monitor = createMonitor({
 *   material: new FlatMaterial({ baseColorTexture: texture, fog: false }),
 *   width: 3.2,
 *   aspect: texture.width / texture.height,
 * });
 *
 * monitor.root.position.set(0, 1.9, 0);
 * view3d.root.addChild(monitor.root);
 * ```
 */
export function createMonitor(options: MonitorOptions): Monitor {
  const { material, width = 3, aspect = 16 / 9, flipV = false, color = 'lilac' } = options;
  const height = width / aspect;
  const rim = width * RIM;
  const depth = width * DEPTH;
  const root = new Container3D({ label: 'monitor' });
  const bezel = new Mesh3D({
    geometry: roundedBox(width + rim * 2, height + rim * 2, depth, rim * 0.7),
    material: clayMaterial(color),
    position: { x: 0, y: 0, z: -depth / 2 - width * GAP },
    parent: root,
  });
  const screen = new Mesh3D({
    geometry: new PlaneGeometry({ width, height, flipV }),
    material,
    // The bezel already casts the monitor's shadow.
    castShadow: false,
    parent: root,
  });

  return {
    root,
    screen,
    bezel,
    size: { width, height },
    destroy() {
      if (root.destroyed) return;
      // Both geometries are the monitor's own; the clay is the kit's and the screen's material the caller's.
      bezel.destroy({ geometry: true });
      screen.destroy({ geometry: true });
      root.destroy();
    },
  };
}
