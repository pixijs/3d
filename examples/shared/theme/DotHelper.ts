/**
 * A flat dot marking one point: a hit point, a muzzle, an aim target
 *
 * A sphere on the kit's shared geometry, one draw. `radius` sizes the dot's own meshes, not the node, so anything you
 * add under it (an arrow from the dot, a label pinned to it) stays in the parent's units and hides with it. `outline: true`
 * adds a rim in the scene's background colour, a camera-facing ring round the dot, so an accent dot still shows on a
 * pink surface. A dot that marks a surface point sits half inside the surface, which would cut the rim and the dot's
 * lower half off, so an outlined dot draws through the scene (`xray`) unless you say otherwise.
 */

import { Geometry3D } from '@pixi/3d';
import type { Mesh3D } from '@pixi/3d';

import { Helper } from './Helper';
import type { HelperOptions } from './Helper';
import { helperGeometry, sharedHelperResource, upNormals } from './helpers';

/** Options for {@link DotHelper} */
export interface DotHelperOptions extends HelperOptions {
  /** @default 'ink' */
  color?: HelperOptions['color'];
  /** @default 0.06 */
  radius?: number;
  /** Whether a rim in the scene's background colour rings it. @default false */
  outline?: boolean;
  /**
   * Draws through whatever is in front of it. An outlined dot needs it to keep its whole rim where it meets a surface;
   * `false` keeps the depth test, and the surface cuts the rim. @default the same as `outline`
   */
  xray?: boolean;
}

/** The rim's outer radius, in dot radii */
const OUTLINE_SCALE = 1.3;
/** The rim's hole, in dot radii: a touch under the dot, so no gap opens at the sphere's faceted edge */
const RIM_HOLE = 0.96;
/** Points round the rim */
const RIM_SEGMENTS = 24;

/** A dot at its node's origin, with an optional rim; one draw, two with the rim */
export class DotHelper extends Helper {
  private readonly _dot: Mesh3D;
  private readonly _outline: Mesh3D | null;
  private _radius = 0.06;

  constructor({ radius = 0.06, outline = false, xray = outline, ...options }: DotHelperOptions = {}) {
    super({ ...options, xray }, 'ink');

    this._dot = this._addPart(helperGeometry('dot'));
    this._outline = outline ? this._addPart(sharedHelperResource('dot:rim', buildRing), 1, 'haze') : null;
    if (this._outline) {
      // The ring stands through the dot's centre facing the camera, its hole on the dot's outline.
      this._outline.billboardMode = 'spherical';
      this._paint();
    }
    this._radius = radius;
    this._size();
  }

  /** The dot's radius in its parent's units; the node's own scale stays 1 */
  get radius(): number {
    return this._radius;
  }
  set radius(value: number) {
    if (value === this._radius) return;
    this._radius = value;
    this._size();
  }

  private _size(): void {
    this._dot.scale.set(this._radius);
    this._outline?.scale.set(this._radius * OUTLINE_SCALE);
  }
}

/** A flat ring of unit outer radius in the xy plane, facing +z the way a camera-facing mesh is authored */
function buildRing(): Geometry3D {
  const hole = RIM_HOLE / OUTLINE_SCALE;
  const positions = new Float32Array(RIM_SEGMENTS * 2 * 3);
  const indices = new Uint16Array(RIM_SEGMENTS * 6);

  for (let i = 0; i < RIM_SEGMENTS; i++) {
    const a = (i / RIM_SEGMENTS) * Math.PI * 2;
    const inner = i * 2;
    const outer = inner + 1;
    const nextInner = ((i + 1) % RIM_SEGMENTS) * 2;
    const nextOuter = nextInner + 1;

    positions[inner * 3] = Math.cos(a) * hole;
    positions[inner * 3 + 1] = Math.sin(a) * hole;
    positions[outer * 3] = Math.cos(a);
    positions[outer * 3 + 1] = Math.sin(a);
    indices.set([inner, outer, nextOuter, inner, nextOuter, nextInner], i * 6);
  }

  return new Geometry3D({ positions, normals: upNormals(RIM_SEGMENTS * 2), indices });
}
