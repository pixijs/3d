import { Buffer, BufferUsage } from 'pixi.js';
import type { TypedArray } from 'pixi.js';

import type { ShaderBit } from '../../core/shader/ShaderBit';
import { Geometry3D } from '../../geometry/Geometry3D';
import { Box } from '../../math/shapes/Box';
import { Vector3 } from '../../math/vector/Vector3';
import { ribbonBits } from './ribbonBit';

/**
 * What a {@link RibbonGeometry}'s widths measure
 *
 * - `'world'`: the units of the points, so it scales with the mesh and thins with distance like any object.
 * - `'pixels'`: pixels on screen, the same at any distance, like a 2D stroke.
 * @example
 * ```ts
 * const units: RibbonWidthUnits = 'pixels';
 * const path = new RibbonGeometry({ points, width: 3, widthUnits: units });
 * ```
 * @category extras:geometry
 * @standard
 */
export type RibbonWidthUnits = 'world' | 'pixels';

/**
 * Options for {@link RibbonGeometry}
 * @example
 * ```ts
 * const options: RibbonGeometryOptions = { points: [0, 0, 0, 1, 1, 0, 2, 0, 0], width: 0.1 };
 * const ribbon = new RibbonGeometry(options);
 * ```
 * @category extras:geometry
 * @standard
 */
export interface RibbonGeometryOptions {
  /**
   * The points the ribbon runs through, x, y and z for each, every line's points one after another
   * @example
   * ```ts
   * const ribbon = new RibbonGeometry({ points: new Float32Array([0, 0, 0, 1, 0.5, 0, 2, 0, 0]) });
   * ```
   */
  points: Float32Array | number[];
  /**
   * How many points each line has, so one geometry draws many lines
   *
   * A number gives every line that many points. Left out, all the points make one line.
   * @example
   * ```ts
   * // Two lines: the first three points, then the next two
   * const ribbon = new RibbonGeometry({ points, pointsPerLine: [3, 2] });
   * ```
   */
  pointsPerLine?: number | number[];
  /**
   * The ribbon's full width, one number for every point or one per point to taper it
   * @default 0.1
   * @example
   * ```ts
   * const tapered = new RibbonGeometry({ points, width: [0.2, 0.1, 0] });
   * ```
   */
  width?: number | Float32Array | number[];
  /**
   * What `width` measures; see {@link RibbonWidthUnits}
   * @default 'world'
   * @example
   * ```ts
   * const outline = new RibbonGeometry({ points, width: 2, widthUnits: 'pixels' });
   * ```
   */
  widthUnits?: RibbonWidthUnits;
  /**
   * A colour for each point, red, green, blue and alpha, blended along the line
   *
   * Read the same way as {@link Geometry3DOptions#colors}: floats as they are, integers as 0 to 1.
   * The material tints with them only when its {@link BaseMaterial3D#vertexColors | vertexColors} is on.
   * @example
   * ```ts
   * const ribbon = new RibbonGeometry({ points, colors: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) });
   * const material = new Material3D({ vertexColors: true });
   * ```
   */
  colors?: Float32Array | Uint16Array | Uint8Array;
  /**
   * Your own data for each point, keyed by the attribute name a shader bit reads it by
   *
   * Each array holds 1 to 4 floats per point, and its length divided by the point count says how many.
   * @example
   * ```ts
   * // One float per point, read as `aGlow` by a bit that declares `attributes: { aGlow: 'float32' }`
   * const ribbon = new RibbonGeometry({ points, pointAttributes: { aGlow: new Float32Array([0, 0.5, 1]) } });
   * ```
   */
  pointAttributes?: Record<string, Float32Array>;
  /**
   * Draw from the geometry's own buffers, so {@link RibbonGeometry#setPoints | setPoints} can move the points, as
   * often as every frame for a trail
   * @default false
   * @example
   * ```ts
   * const trail = new RibbonGeometry({ points: new Float32Array(64 * 3), dynamic: true });
   * ```
   */
  dynamic?: boolean;
}

/** `COPY_DST` as `Geometry3D` gives its own attributes, so WebGPU accepts the re-upload after `setPoints` */
function vertexBuffer(data: Float32Array): Buffer {
  return new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
}

function doublePerPoint<T extends TypedArray>(data: T, size: number): T {
  const out = new (data.constructor as new (length: number) => T)(data.length * 2);

  for (let p = 0, count = data.length / size; p < count; p++) {
    for (let c = 0; c < size; c++) {
      const value = data[p * size + c];
      out[p * 2 * size + c] = value;
      out[(p * 2 + 1) * size + c] = value;
    }
  }

  return out;
}

/**
 * Writes the two vertices of every point: the point itself, its direction along the line into `aRibbon.xyz`, and
 * the distance along the line into `u`; leaves the widths in `aRibbon.w` alone
 */
function writeCentreline(
  points: ArrayLike<number>,
  lineSizes: number[],
  positions: Float32Array,
  ribbon: Float32Array,
  uvs: Float32Array,
): void {
  let at = 0;
  let position = 0;
  let direction = 0;
  let uv = 0;

  for (let l = 0; l < lineSizes.length; l++) {
    const count = lineSizes[l];
    if (count === 0) continue;

    const last = at + (count - 1) * 3;
    let distance = 0;
    let prevX = points[at];
    let prevY = points[at + 1];
    let prevZ = points[at + 2];
    let x = prevX;
    let y = prevY;
    let z = prevZ;

    for (; at <= last; at += 3) {
      const next = at < last ? at + 3 : at;
      const nextX = points[next];
      const nextY = points[next + 1];
      const nextZ = points[next + 2];
      const stepX = x - prevX;
      const stepY = y - prevY;
      const stepZ = z - prevZ;
      const alongX = nextX - prevX;
      const alongY = nextY - prevY;
      const alongZ = nextZ - prevZ;

      distance += Math.sqrt(stepX * stepX + stepY * stepY + stepZ * stepZ);

      positions[position] = x;
      positions[position + 1] = y;
      positions[position + 2] = z;
      positions[position + 3] = x;
      positions[position + 4] = y;
      positions[position + 5] = z;
      ribbon[direction] = alongX;
      ribbon[direction + 1] = alongY;
      ribbon[direction + 2] = alongZ;
      ribbon[direction + 4] = alongX;
      ribbon[direction + 5] = alongY;
      ribbon[direction + 6] = alongZ;
      uvs[uv] = distance;
      uvs[uv + 1] = 0;
      uvs[uv + 2] = distance;
      uvs[uv + 3] = 1;

      position += 6;
      direction += 8;
      uv += 4;
      prevX = x;
      prevY = y;
      prevZ = z;
      x = nextX;
      y = nextY;
      z = nextZ;
    }
  }
}

/**
 * The box round the points, read from the first of each point's two vertices. A function of its own: as a loop in
 * the constructor it measured 4 to 14 KB of garbage a build
 */
function boundsOfPoints(positions: Float32Array): Box {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 6) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return new Box(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

/**
 * A line of points drawn as a strip that turns to face the camera, with a width in world units or pixels
 *
 * Use it for wide lines, paths, trails, cables, hair and fibres: the `'line-list'` topology draws lines only 1 px
 * wide. Give it to a {@link Mesh3D} with any material whose `extraBits` include the ribbon's
 * {@link RibbonGeometry#shaderBit | shaderBit}. One geometry can draw many lines, and each point can have its own
 * width and colour.
 *
 * Each point becomes two vertices, built once on the CPU. The vertex shader pushes them apart across the line,
 * facing the camera, every time the ribbon is drawn, so shadows face their light. A lit material shades the strip
 * as a round cord. `uv` runs along the line as distance in the points' units, `u`, and across it from 0 to 1, `v`.
 *
 * - Corners pinch: a point's width runs square to the line's average direction there, so a sharp turn draws
 *   narrower. Add points either side of a corner to keep it full.
 * - Each line ends flat at its first and last point; repeat the first point at the end to close a loop.
 * - Picking can't hit the strip, since it only exists on the GPU; give the mesh a box or sphere
 *   {@link Container3D#hitVolume | hitVolume} instead.
 * - A pixel ribbon is never frustum-culled, since its edge lies a number of pixels from its points that no bounds
 *   in world units can hold, and a light's automatic shadow box leaves it out. Its shadow is its width in shadow
 *   map texels.
 * - An {@link OutlinePass} outline doesn't show: it draws the mesh's back faces, and a ribbon always faces the
 *   camera.
 * @example
 * ```ts
 * const helix: number[] = [];
 * for (let i = 0; i <= 64; i++) helix.push(Math.cos(i * 0.3), i * 0.05, Math.sin(i * 0.3));
 *
 * const ribbon = new RibbonGeometry({ points: helix, width: 0.08 });
 * const spring = new Mesh3D({
 *   geometry: ribbon,
 *   material: new Material3D({ baseColor: 0xe72264, extraBits: [ribbon.shaderBit] }),
 * });
 * ```
 * @category extras:geometry
 * @standard
 */
export class RibbonGeometry extends Geometry3D {
  /**
   * Defaults for every new `RibbonGeometry`
   * @example
   * ```ts
   * RibbonGeometry.defaultOptions.widthUnits = 'pixels';
   * RibbonGeometry.defaultOptions.width = 2;
   * ```
   */
  public static defaultOptions: Omit<RibbonGeometryOptions, 'points'> = {
    width: 0.1,
    widthUnits: 'world',
    dynamic: false,
  };

  /**
   * What the widths measure, fixed at construction
   * @example
   * ```ts
   * const ribbon = new RibbonGeometry({ points, widthUnits: 'pixels' });
   * ribbon.widthUnits; // 'pixels'
   * ```
   */
  public readonly widthUnits: RibbonWidthUnits;

  /**
   * The shader bit that turns the strip to face the camera, for the material's `extraBits`
   *
   * Without it the strip has no width, so nothing draws. The bit reads the ribbon's own vertex data, so a
   * material that carries it draws only ribbons, and only ribbons with the same {@link RibbonGeometry#widthUnits},
   * which share one bit. It runs in shadows too, facing each light.
   * @example
   * ```ts
   * const ribbon = new RibbonGeometry({ points, width: 0.1 });
   * const material = new Material3D({ extraBits: [ribbon.shaderBit] });
   * ```
   */
  public readonly shaderBit: ShaderBit;

  /** Points in each line, in order */
  private readonly _lineSizes: number[];

  /**
   * Creates a new `RibbonGeometry`
   * @param options - See {@link RibbonGeometryOptions} for available options
   */
  constructor(options: RibbonGeometryOptions) {
    const { points, pointsPerLine, width, widthUnits, colors, pointAttributes, dynamic } = {
      ...RibbonGeometry.defaultOptions,
      ...options,
    };
    const pointCount = Math.floor(points.length / 3);
    const lineSizes =
      pointsPerLine === undefined
        ? [pointCount]
        : typeof pointsPerLine === 'number'
          ? // oxlint-disable-next-line unicorn/no-new-array -- the argument is the length, and Array.from fills a list this long one element at a time
            new Array<number>(Math.floor(pointCount / pointsPerLine)).fill(pointsPerLine)
          : pointsPerLine;
    const vertexCount = pointCount * 2;

    const positions = new Float32Array(vertexCount * 3);
    const ribbon = new Float32Array(vertexCount * 4);
    const uvs = new Float32Array(vertexCount * 2);

    writeCentreline(points, lineSizes, positions, ribbon, uvs);

    let widest = 0;
    for (let p = 0; p < pointCount; p++) {
      const w = typeof width === 'number' ? width : width![p];
      ribbon[p * 8 + 3] = -w;
      ribbon[p * 8 + 7] = w;
      widest = Math.max(widest, w);
    }

    let segmentCount = 0;
    for (let l = 0; l < lineSizes.length; l++) segmentCount += Math.max(lineSizes[l] - 1, 0);

    const indices = vertexCount > 65536 ? new Uint32Array(segmentCount * 6) : new Uint16Array(segmentCount * 6);
    let k = 0;
    let start = 0;

    for (let l = 0; l < lineSizes.length; l++) {
      for (let i = 0; i < lineSizes[l] - 1; i++) {
        const left = (start + i) * 2;
        indices[k++] = left;
        indices[k++] = left + 1;
        indices[k++] = left + 2;
        indices[k++] = left + 1;
        indices[k++] = left + 3;
        indices[k++] = left + 2;
      }
      start += lineSizes[l];
    }

    const bounds3D = boundsOfPoints(positions);
    const pad = widthUnits === 'world' ? widest * 0.5 : 0;
    bounds3D.min.set(bounds3D.min.x - pad, bounds3D.min.y - pad, bounds3D.min.z - pad);
    bounds3D.max.set(bounds3D.max.x + pad, bounds3D.max.y + pad, bounds3D.max.z + pad);

    super({
      positions,
      uvs,
      colors: colors && doublePerPoint(colors, 4),
      indices,
      dynamic,
      bounds3D,
      interleave: false,
      topology: 'triangle-list',
    });

    this.addAttribute('aRibbon', { buffer: vertexBuffer(ribbon), format: 'float32x4' });
    for (const name in pointAttributes) {
      const data = pointAttributes[name];
      const size = data.length / pointCount;
      this.addAttribute(name, {
        buffer: vertexBuffer(doublePerPoint(data, size)),
        format: size === 1 ? 'float32' : (`float32x${size}` as 'float32x2' | 'float32x3' | 'float32x4'),
      });
    }

    this.widthUnits = widthUnits!;
    this._lineSizes = lineSizes;
    this.shaderBit = ribbonBits[this.widthUnits];
    if (this.widthUnits === 'pixels') this.boundsSphere.makeEmpty();
  }

  /**
   * Moves every point, keeping the lines, widths and colours
   *
   * Only a {@link RibbonGeometryOptions#dynamic | dynamic} ribbon draws the new points, from the next frame, so
   * call it every frame for a trail. A ribbon built without `dynamic` keeps drawing the points it was built with;
   * build a new one for a new shape. Pass as many points as the ribbon was built with. The bounds stay as built,
   * and a dynamic ribbon is never frustum-culled.
   * @param points - The new points, x, y and z for each, in the order the ribbon was built with.
   * @example
   * ```ts
   * const trail = new RibbonGeometry({ points: new Float32Array(32 * 3), dynamic: true });
   *
   * app.ticker.add(() => {
   *   writeTrailPoints(trailPoints);
   *   trail.setPoints(trailPoints);
   * });
   * ```
   */
  public setPoints(points: Float32Array | number[]): void {
    const attributes = this.attributes;

    writeCentreline(
      points,
      this._lineSizes,
      attributes.aPosition.buffer.data as Float32Array,
      attributes.aRibbon.buffer.data as Float32Array,
      attributes.aUV.buffer.data as Float32Array,
    );
    attributes.aPosition.buffer.update();
    attributes.aRibbon.buffer.update();
    attributes.aUV.buffer.update();
  }
}
