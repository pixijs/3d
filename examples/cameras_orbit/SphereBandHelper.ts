/**
 * A see-through band of a sphere between two polar angles, and between two azimuths while both are finite, with its
 * edges outlined: everywhere an OrbitCamera's limits let the camera stand at one distance
 *
 * It lives in this example until a second one needs it, then moves to the kit's helpers as it is. It's a kit
 * `Helper`, so the surface follows the theme like every helper.
 */

import { Geometry3D } from '@pixi/3d';
import type { Destroy3DOptions, Mesh3D } from '@pixi/3d';

import { Helper } from '../shared/theme/Helper';
import type { HelperOptions } from '../shared/theme/Helper';
import { upNormals } from '../shared/theme/helpers';
import { PathHelper } from '../shared/theme/PathHelper';

/** One of the band's four edges, named for the limit that draws it */
type BandEdge = 'minPolar' | 'maxPolar' | 'minAzimuth' | 'maxAzimuth';

/** Steps down the band and round it: enough that a band from the top to the rim reads as round */
const ROWS = 16;
const COLUMNS = 64;
/** The surface's share of the helper's opacity: a faint film that shows the shape without hiding what's inside */
const SURFACE_SHADE = 0.1;

/** Two triangles per cell of a grid `COLUMNS + 1` vertices wide; the material draws both sides, so winding is free */
function gridIndices(): Uint16Array {
  const indices = new Uint16Array(ROWS * COLUMNS * 6);
  let n = 0;

  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++, n += 6) {
      const a = row * (COLUMNS + 1) + column;
      const b = a + COLUMNS + 1;

      indices.set([a, b, a + 1, a + 1, b, b + 1], n);
    }
  }

  return indices;
}

/** An azimuth limit as the orbit applies it: brought into -π to π */
function wrapAzimuth(azimuth: number): number {
  return azimuth < -Math.PI ? azimuth + Math.PI * 2 : azimuth > Math.PI ? azimuth - Math.PI * 2 : azimuth;
}

/** Writes the point at `polar` and `azimuth` on a sphere of `radius` into `out` at `i`, the way Spherical does */
function writePoint(out: Float32Array, i: number, radius: number, polar: number, azimuth: number): void {
  out[i * 3] = radius * Math.sin(polar) * Math.sin(azimuth);
  out[i * 3 + 1] = radius * Math.cos(polar);
  out[i * 3 + 2] = radius * Math.sin(polar) * Math.cos(azimuth);
}

export interface SphereBandHelperOptions extends HelperOptions {
  /** The edges' line width. @default 0.035 */
  thickness?: number;
}

/**
 * The part of a sphere round its origin that an OrbitCamera's polar and azimuth limits leave open
 *
 * {@link SphereBandHelper#set} takes the limits and {@link SphereBandHelper#radius} the distance; each rebuilds only
 * what changed. With the minimum polar angle at or past the maximum it draws only the minimum's ring, where the
 * orbit's clamp holds the camera.
 * @example
 * ```ts
 * const band = new SphereBandHelper({ parent: inset.root });
 * band.set(orbit.minPolarAngle, orbit.maxPolarAngle, orbit.minAzimuthAngle, orbit.maxAzimuthAngle);
 * band.radius = orbit.distance;
 * ```
 */
export class SphereBandHelper extends Helper {
  private readonly _surface: Geometry3D;
  /** The surface's positions on the unit sphere, written in place */
  private readonly _positions: Float32Array;
  private readonly _surfaceMesh: Mesh3D;
  private readonly _edges: Record<BandEdge, PathHelper>;
  private readonly _ring = new Float32Array((COLUMNS + 1) * 3);
  private readonly _meridian = new Float32Array((ROWS + 1) * 3);
  /** The limits it shows, in radians */
  private readonly _angles = { minPolar: 0, maxPolar: 0, minAzimuth: 0, maxAzimuth: 0 };
  private _radius = 1;
  private _thickness: number;
  /** The azimuth span, start to end, the end past the start */
  private _start = -Math.PI;
  private _end = Math.PI;

  constructor({ thickness = 0.035, ...options }: SphereBandHelperOptions = {}) {
    super(options, 'ink');
    this._thickness = thickness;

    const vertices = (ROWS + 1) * (COLUMNS + 1);

    this._positions = new Float32Array(vertices * 3);
    this._surface = new Geometry3D({
      positions: this._positions,
      normals: upNormals(vertices),
      indices: gridIndices(),
      dynamic: true,
    });
    this._surfaceMesh = this._addPart(this._surface, SURFACE_SHADE);

    const edge = (capacity: number): PathHelper => new PathHelper({ thickness, capacity, parent: this });

    this._edges = {
      minPolar: edge(COLUMNS + 1),
      maxPolar: edge(COLUMNS + 1),
      minAzimuth: edge(ROWS + 1),
      maxAzimuth: edge(ROWS + 1),
    };
  }

  /** The sphere's radius; the surface scales, and the edges are redrawn so their width holds */
  get radius(): number {
    return this._radius;
  }
  set radius(value: number) {
    if (value === this._radius) return;
    this._radius = value;
    this._surfaceMesh.scale.set(value);
    this._drawEdges();
  }

  /** Every edge's line width */
  get thickness(): number {
    return this._thickness;
  }
  set thickness(value: number) {
    this._thickness = value;
    for (const edge of Object.values(this._edges)) edge.thickness = value;
  }

  /**
   * Reshapes the band for an orbit's limits, in radians; infinite azimuths mean a full turn. Nothing is rebuilt when
   * they're the ones it already shows, so calling it every frame is cheap.
   */
  public set(minPolar: number, maxPolar: number, minAzimuth: number, maxAzimuth: number): this {
    const angles = this._angles;

    if (angles.minPolar === minPolar && angles.maxPolar === maxPolar) {
      if (angles.minAzimuth === minAzimuth && angles.maxAzimuth === maxAzimuth) return this;
    }
    Object.assign(angles, { minPolar, maxPolar, minAzimuth, maxAzimuth });

    // Infinite azimuths are a full turn; a minimum past the maximum runs through ±π, as the orbit's clamp does.
    const limited = isFinite(minAzimuth) && isFinite(maxAzimuth);

    this._start = limited ? wrapAzimuth(minAzimuth) : -Math.PI;
    this._end = limited ? wrapAzimuth(maxAzimuth) : Math.PI;
    if (this._end < this._start) this._end += Math.PI * 2;
    this._drawSurface();
    this._drawEdges();

    return this;
  }

  /** Destroys its surface, with the geometry it built, and its edges */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;
    for (const edge of Object.values(this._edges)) edge.destroy();
    super.destroy(options);
    this._surface.destroy(true);
  }

  /** Lays the unit sphere's grid over the open band; it hides when the polar limits leave only a ring */
  private _drawSurface(): void {
    const { minPolar, maxPolar } = this._angles;
    const { _start: start, _end: end } = this;

    this._showPart(this._surfaceMesh, minPolar < maxPolar);
    for (let row = 0; row <= ROWS; row++) {
      const polar = minPolar + ((maxPolar - minPolar) * row) / ROWS;

      for (let column = 0; column <= COLUMNS; column++) {
        writePoint(this._positions, row * (COLUMNS + 1) + column, 1, polar, start + ((end - start) * column) / COLUMNS);
      }
    }
    this._surface.attributes.aPosition.buffer.update();
  }

  /** Draws the two polar rings and, while the azimuths are limited, the two meridians between them */
  private _drawEdges(): void {
    const { minPolar, maxPolar, minAzimuth, maxAzimuth } = this._angles;
    const band = minPolar < maxPolar;
    const limited = band && isFinite(minAzimuth) && isFinite(maxAzimuth);

    this._drawRing('minPolar', minPolar, true);
    this._drawRing('maxPolar', maxPolar, band);
    this._drawMeridian('minAzimuth', this._start, limited);
    this._drawMeridian('maxAzimuth', this._end, limited);
  }

  /** The ring at one polar angle, across the azimuth span */
  private _drawRing(edge: BandEdge, polar: number, shown: boolean): void {
    const { _start: start, _end: end, _radius: radius } = this;

    for (let column = 0; column <= COLUMNS; column++) {
      writePoint(this._ring, column, radius, polar, start + ((end - start) * column) / COLUMNS);
    }
    this._edges[edge].setPoints(this._ring, shown ? COLUMNS + 1 : 0);
  }

  /** The meridian at one azimuth, between the polar limits */
  private _drawMeridian(edge: BandEdge, azimuth: number, shown: boolean): void {
    const { minPolar, maxPolar } = this._angles;

    for (let row = 0; row <= ROWS; row++) {
      writePoint(this._meridian, row, this._radius, minPolar + ((maxPolar - minPolar) * row) / ROWS, azimuth);
    }
    this._edges[edge].setPoints(this._meridian, shown ? ROWS + 1 : 0);
  }
}
