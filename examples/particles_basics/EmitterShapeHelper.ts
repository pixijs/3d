/**
 * An emitter shape drawn where it sits: lines round the region a particle starts in, and short arrows the ways it
 * heads
 *
 * It's a kit `Helper` on one `BarsGeometry`, so every ring, edge and arrow is one draw (a point's dot is a second),
 * and `color` and `muted` work as on any helper. Add it as the system's child: a shape samples in the emitter's own
 * space, so the drawing moves and turns with the emitter.
 */

import type { Destroy3DOptions, Mesh3D, PointData3D, Vector3 } from '@pixi/3d';
import { BoxShape, ConeShape, PointShape, SphereShape } from '@pixi/3d/extras';
import type { EmitterShape } from '@pixi/3d/extras';
import { DEG_TO_RAD } from 'pixi.js';

import { BarsGeometry } from '../shared/theme/BarsGeometry';
import { Helper } from '../shared/theme/Helper';
import type { HelperOptions } from '../shared/theme/Helper';
import { HEAD_LENGTH, HEAD_WIDTH, helperGeometry } from '../shared/theme/helpers';

export interface EmitterShapeHelperOptions extends HelperOptions {
  shape: EmitterShape;
  /** How tall the cone's outline stands, and how far the direction arrows reach. @default 0.6 */
  length?: number;
  /** Each line's width. @default 0.018 */
  thickness?: number;
}

/** Bars round each ring: enough to read as round at a few hundred pixels across */
const RING_BARS = 32;
/** The most bars a shape takes: a sphere's three rings and six arrows */
const CAPACITY = RING_BARS * 3 + 12;
/** The point shape's dot, in line widths */
const DOT_RADIUS = 3;
/** The ring round the point shape's dot, as a share of `length`: wide enough to show past the path that starts there */
const POINT_RING = 0.2;

/**
 * Draws the four built-in shapes: a cone's spawn disc, flare and axis, a sphere's three great circles and the six
 * ways out of it, a box's twelve edges with arrows up from its top, and a point as a ringed dot
 * @example
 * ```ts
 * const outline = new EmitterShapeHelper({ shape: sparks.shape, parent: sparks });
 *
 * app.ticker.add(() => {
 *   outline.shape = sparks.shape; // redraws only when the shape object changes
 * });
 * ```
 */
export class EmitterShapeHelper extends Helper {
  private readonly _bars = new BarsGeometry(CAPACITY);
  private readonly _dot: Mesh3D;
  private readonly _length: number = 0;
  private readonly _thickness: number = 0;
  private _shape: EmitterShape;
  private _count = 0;

  constructor({ shape, length = 0.6, thickness = 0.018, ...options }: EmitterShapeHelperOptions) {
    super(options, 'ink');
    this._length = length;
    this._thickness = thickness;
    this._addPart(this._bars);
    this._dot = this._addPart(helperGeometry('dot'));
    this._dot.scale.set(thickness * DOT_RADIUS);
    this._shape = shape;
    this._build(shape);
  }

  /** The shape it draws; setting another shape object redraws it */
  get shape(): EmitterShape {
    return this._shape;
  }
  set shape(value: EmitterShape) {
    if (value === this._shape) return;
    this._shape = value;
    this._build(value);
  }

  /**
   * The outline's outermost point toward a level direction, in its own space, for a label's leader: the rim of a
   * cone's flare, a sphere's equator, the edge of a box's top or the point's ring
   */
  public rim(toward: PointData3D, out: Vector3): Vector3 {
    const shape = this._shape;

    if (shape instanceof ConeShape) {
      const flare = this._flare(shape);

      return out.set(toward.x * flare, this._length, toward.z * flare);
    }
    if (shape instanceof SphereShape) return out.set(toward.x * shape.radius, 0, toward.z * shape.radius);
    if (shape instanceof BoxShape) {
      // As far along `toward` as the top face reaches, which lands on one of its edges.
      const reach = Math.min(shape.width / 2 / Math.abs(toward.x), shape.depth / 2 / Math.abs(toward.z));

      return out.set(toward.x * reach, shape.height / 2, toward.z * reach);
    }

    return out.set(toward.x * this._length * POINT_RING, 0, toward.z * this._length * POINT_RING);
  }

  /** Frees its bars, after the base destroys its meshes */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;
    super.destroy(options);
    this._bars.destroy();
  }

  private _build(shape: EmitterShape): void {
    const length = this._length;

    this._count = 0;
    if (shape instanceof ConeShape) {
      const flare = this._flare(shape);

      this._ring(shape.radius, 'y');
      this._ring(flare, 'y', length);
      for (let k = 0; k < 4; k++) {
        const c = Math.cos((k * Math.PI) / 2);
        const s = Math.sin((k * Math.PI) / 2);

        this._line(c * shape.radius, 0, s * shape.radius, c * flare, length, s * flare);
      }
      // The axis pokes out past the flare, so its head shows above the spray's base.
      this._arrow(0, 0, 0, 0, 1, 0, length * 1.25);
    } else if (shape instanceof SphereShape) {
      const r = shape.radius;

      this._ring(r, 'x');
      this._ring(r, 'y');
      this._ring(r, 'z');
      for (let axis = 0; axis < 3; axis++) {
        for (const sign of [1, -1]) {
          const x = axis === 0 ? sign : 0;
          const y = axis === 1 ? sign : 0;
          const z = axis === 2 ? sign : 0;

          this._arrow(x * r, y * r, z * r, x, y, z, length / 2);
        }
      }
    } else if (shape instanceof BoxShape) {
      this._box(shape.width / 2, shape.height / 2, shape.depth / 2);
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          this._arrow((x * shape.width) / 4, shape.height / 2, (z * shape.depth) / 4, 0, 1, 0, length / 2);
        }
      }
    } else if (shape instanceof PointShape) {
      // No arrow: a point's sparks all fly up one line, which the drawn path already traces.
      this._ring(length * POINT_RING, 'y');
    }

    this._showPart(this._dot, shape instanceof PointShape);
    this._bars.count = this._count;
    this._bars.update();
  }

  /** The radius of a cone's outline at its top, `length` up */
  private _flare(shape: ConeShape): number {
    return shape.radius + this._length * Math.tan(shape.angle * DEG_TO_RAD);
  }

  /** A ring of `radius` round the emitter, square to `axis`; a ring round y can be raised to height `y` */
  private _ring(radius: number, axis: 'x' | 'y' | 'z', y = 0): void {
    const step = (Math.PI * 2) / RING_BARS;

    for (let i = 0; i < RING_BARS; i++) {
      const a0 = Math.cos(i * step) * radius;
      const b0 = Math.sin(i * step) * radius;
      const a1 = Math.cos((i + 1) * step) * radius;
      const b1 = Math.sin((i + 1) * step) * radius;

      if (axis === 'y') this._line(a0, y, b0, a1, y, b1);
      else if (axis === 'x') this._line(0, a0, b0, 0, a1, b1);
      else this._line(a0, b0, 0, a1, b1, 0);
    }
  }

  /** The box's twelve edges, for half sizes `x`, `y` and `z` */
  private _box(x: number, y: number, z: number): void {
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) {
        this._line(-x, s * y, t * z, x, s * y, t * z);
        this._line(s * x, -y, t * z, s * x, y, t * z);
        this._line(s * x, t * y, -z, s * x, t * y, z);
      }
    }
  }

  /** An arrow `length` long from a point along a unit direction, its head in the same bars as its line */
  private _arrow(x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number): void {
    const head = this._thickness * HEAD_LENGTH;
    const shaft = length - head;

    this._line(x, y, z, x + dx * shaft, y + dy * shaft, z + dz * shaft);
    this._bars.setBar(
      this._count++,
      x + dx * shaft,
      y + dy * shaft,
      z + dz * shaft,
      x + dx * length,
      y + dy * length,
      z + dz * length,
      (this._thickness * HEAD_WIDTH) / 2,
      0,
    );
  }

  private _line(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    this._bars.setBar(this._count++, ax, ay, az, bx, by, bz, this._thickness / 2);
  }
}
