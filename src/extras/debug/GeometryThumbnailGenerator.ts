import { definedProps, DOMAdapter } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';

/** Canvas size, in pixels, that `PADDING` is authored at; other sizes scale the whole layout */
const REFERENCE_SIZE = 64;
const MAX_TRIANGLES = 20_000;
const PADDING = 5;
const YAW = -Math.PI / 5;
const PITCH = Math.PI / 7;
const COLOR = { r: 105, g: 151, b: 181 };
const LIGHT = { x: -0.33, y: 0.58, z: 0.74 };

/**
 * Why a geometry could not be rendered to a thumbnail
 * @category extras:debug
 * @advanced
 */
export type GeometryThumbnailUnsupportedReason =
  | 'dynamic'
  | 'empty'
  | 'invalid-positions'
  | 'missing-indices'
  | 'missing-positions'
  | 'too-many-triangles'
  | 'unsupported-index-buffer'
  | 'unsupported-position-format'
  | 'unsupported-topology';

/**
 * A successfully generated geometry thumbnail
 * @category extras:debug
 * @advanced
 */
export interface GeometryThumbnailReady {
  /** Discriminant for {@link GeometryThumbnailResult} */
  status: 'ready';
  /** `uid` of the source geometry */
  geometryId: number;
  /** Canvas holding the shaded render */
  canvas: HTMLCanvasElement;
}

/**
 * A geometry that could not be thumbnailed, with the reason
 * @category extras:debug
 * @advanced
 */
export interface GeometryThumbnailUnsupported {
  /** Discriminant for {@link GeometryThumbnailResult} */
  status: 'unsupported';
  /** `uid` of the source geometry */
  geometryId: number;
  /** Why the thumbnail could not be generated */
  reason: GeometryThumbnailUnsupportedReason;
}

/**
 * Outcome of a thumbnail request: the ready canvas, or the reason it was unsupported
 * @category extras:debug
 * @advanced
 */
export type GeometryThumbnailResult = GeometryThumbnailReady | GeometryThumbnailUnsupported;

interface ProjectedTriangle {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  depth: number;
  brightness: number;
}

/**
 * Constructor options for {@link GeometryThumbnailGenerator}
 * @example
 * ```ts
 * const thumbnails = new GeometryThumbnailGenerator({ size: 32 });
 * ```
 * @category extras:debug
 * @advanced
 */
export interface GeometryThumbnailGeneratorOptions {
  /**
   * Width and height of each thumbnail canvas, in pixels
   * @default 64
   */
  size?: number;
}

/**
 * Generates and caches material-independent {@link Geometry3D} thumbnails by geometry ID
 *
 * Renders a small shaded canvas preview on the CPU (no GPU resources), used by the debug
 * overlay to identify geometries at a glance.
 * @category extras:debug
 * @advanced
 */
export class GeometryThumbnailGenerator {
  /**
   * Default {@link GeometryThumbnailGeneratorOptions} merged under every constructor call
   *
   * `new GeometryThumbnailGenerator(opts)` resolves as `{ ...GeometryThumbnailGenerator.defaultOptions, ...opts }`.
   * @example
   * ```ts
   * GeometryThumbnailGenerator.defaultOptions.size = 96;
   * ```
   */
  public static defaultOptions: GeometryThumbnailGeneratorOptions = {
    size: 64,
  };

  private readonly _size: number = 0;
  private readonly _cache = new Map<number, GeometryThumbnailResult>();

  /** @param options - Generator options; see {@link GeometryThumbnailGeneratorOptions} */
  constructor(options: GeometryThumbnailGeneratorOptions = {}) {
    const { size } = { ...GeometryThumbnailGenerator.defaultOptions, ...definedProps(options) };

    this._size = Math.max(1, Math.floor(size!));
  }

  /**
   * Returns the cached thumbnail for a geometry, generating (and caching) it on first request
   * @param geometry - The geometry to thumbnail.
   * @returns The ready thumbnail, or the reason it is unsupported.
   */
  public getThumbnail(geometry: Geometry3D): GeometryThumbnailResult {
    const cached = this._cache.get(geometry.uid);
    if (cached) return cached;

    const result = this._generate(geometry);
    this._cache.set(geometry.uid, result);
    return result;
  }

  /**
   * Returns the cached thumbnail for a geometry ID, if one was generated
   * @param geometryId - The geometry `uid` to look up.
   * @returns The cached result, or `undefined` when the geometry was never thumbnailed.
   */
  public getThumbnailById(geometryId: number): GeometryThumbnailResult | undefined {
    return this._cache.get(geometryId);
  }

  /**
   * Drops cached thumbnails for geometries no longer in use
   * @param retainedGeometryIds - Geometry `uid`s to keep; everything else is evicted.
   */
  public prune(retainedGeometryIds: ReadonlySet<number>): void {
    for (const geometryId of this._cache.keys()) {
      if (!retainedGeometryIds.has(geometryId)) this._cache.delete(geometryId);
    }
  }

  /** Empties the thumbnail cache */
  public clear(): void {
    this._cache.clear();
  }

  private _generate(geometry: Geometry3D): GeometryThumbnailResult {
    if (geometry.dynamic) return unsupported(geometry.uid, 'dynamic');
    if (geometry.topology !== 'triangle-list') return unsupported(geometry.uid, 'unsupported-topology');

    const positionAttribute = geometry.attributes.aPosition;
    if (!positionAttribute) return unsupported(geometry.uid, 'missing-positions');
    if (positionAttribute.format !== 'float32x3') {
      return unsupported(geometry.uid, 'unsupported-position-format');
    }

    const positionData = positionAttribute.buffer.data;
    if (!ArrayBuffer.isView(positionData)) return unsupported(geometry.uid, 'invalid-positions');

    const indexData = geometry.indexBuffer?.data;
    if (!indexData) return unsupported(geometry.uid, 'missing-indices');
    if (!(indexData instanceof Uint16Array) && !(indexData instanceof Uint32Array)) {
      return unsupported(geometry.uid, 'unsupported-index-buffer');
    }

    const triangleCount = Math.floor(indexData.length / 3);
    if (geometry.vertexCount === 0 || triangleCount === 0) return unsupported(geometry.uid, 'empty');
    if (triangleCount > MAX_TRIANGLES) return unsupported(geometry.uid, 'too-many-triangles');

    const positions = readPositions(
      positionData,
      geometry.vertexCount,
      positionAttribute.stride,
      positionAttribute.offset,
    );
    if (!positions) return unsupported(geometry.uid, 'invalid-positions');

    const projected = projectPositions(positions);
    if (!projected) return unsupported(geometry.uid, 'invalid-positions');

    const triangles = buildTriangles(projected.positions, indexData, projected.scale, this._size);
    if (triangles.length === 0) return unsupported(geometry.uid, 'empty');

    triangles.sort((a, b) => a.depth - b.depth);

    const canvas = DOMAdapter.get().createCanvas(this._size, this._size) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return unsupported(geometry.uid, 'empty');

    for (let i = 0; i < triangles.length; i++) {
      const triangle = triangles[i];
      context.beginPath();
      context.moveTo(triangle.ax, triangle.ay);
      context.lineTo(triangle.bx, triangle.by);
      context.lineTo(triangle.cx, triangle.cy);
      context.closePath();
      context.fillStyle = shadedColor(triangle.brightness);
      context.fill();
    }

    return { status: 'ready', geometryId: geometry.uid, canvas };
  }
}

function unsupported(geometryId: number, reason: GeometryThumbnailUnsupportedReason): GeometryThumbnailUnsupported {
  return { status: 'unsupported', geometryId, reason };
}

function readPositions(
  data: ArrayBufferView,
  vertexCount: number,
  stride: number | undefined,
  offset: number | undefined,
): Float32Array | null {
  const byteStride = stride ?? 12;
  const byteOffset = offset ?? 0;
  const lastByte = byteOffset + (vertexCount - 1) * byteStride + 12;
  if (byteStride < 12 || byteOffset < 0 || lastByte > data.byteLength) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const source = byteOffset + i * byteStride;
    const target = i * 3;
    const x = view.getFloat32(source, true);
    const y = view.getFloat32(source + 4, true);
    const z = view.getFloat32(source + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    positions[target] = x;
    positions[target + 1] = y;
    positions[target + 2] = z;
  }
  return positions;
}

function projectPositions(positions: Float32Array): { positions: Float32Array; scale: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  if (!Number.isFinite(minX) || (maxX === minX && maxY === minY && maxZ === minZ)) return null;

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const sinYaw = Math.sin(YAW);
  const cosYaw = Math.cos(YAW);
  const sinPitch = Math.sin(PITCH);
  const cosPitch = Math.cos(PITCH);
  const projected = new Float32Array(positions.length);
  let projectedMinX = Infinity;
  let projectedMinY = Infinity;
  let projectedMaxX = -Infinity;
  let projectedMaxY = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - centerX;
    const y = positions[i + 1] - centerY;
    const z = positions[i + 2] - centerZ;
    const yawX = x * cosYaw - z * sinYaw;
    const yawZ = x * sinYaw + z * cosYaw;
    const pitchY = y * cosPitch - yawZ * sinPitch;
    const pitchZ = y * sinPitch + yawZ * cosPitch;
    projected[i] = yawX;
    projected[i + 1] = pitchY;
    projected[i + 2] = pitchZ;
    projectedMinX = Math.min(projectedMinX, yawX);
    projectedMinY = Math.min(projectedMinY, pitchY);
    projectedMaxX = Math.max(projectedMaxX, yawX);
    projectedMaxY = Math.max(projectedMaxY, pitchY);
  }

  const extent = Math.max(projectedMaxX - projectedMinX, projectedMaxY - projectedMinY);
  if (!Number.isFinite(extent) || extent <= 0) return null;
  const projectedCenterX = (projectedMinX + projectedMaxX) * 0.5;
  const projectedCenterY = (projectedMinY + projectedMaxY) * 0.5;
  for (let i = 0; i < projected.length; i += 3) {
    projected[i] -= projectedCenterX;
    projected[i + 1] -= projectedCenterY;
  }
  return { positions: projected, scale: (REFERENCE_SIZE - PADDING * 2) / extent };
}

function buildTriangles(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  normalizedScale: number,
  size: number,
): ProjectedTriangle[] {
  const scale = normalizedScale * (size / REFERENCE_SIZE);
  const center = size * 0.5;
  const triangles: ProjectedTriangle[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ai = indices[i] * 3;
    const bi = indices[i + 1] * 3;
    const ci = indices[i + 2] * 3;
    if (ai + 2 >= positions.length || bi + 2 >= positions.length || ci + 2 >= positions.length) continue;

    const abx = positions[bi] - positions[ai];
    const aby = positions[bi + 1] - positions[ai + 1];
    const abz = positions[bi + 2] - positions[ai + 2];
    const acx = positions[ci] - positions[ai];
    const acy = positions[ci + 1] - positions[ai + 1];
    const acz = positions[ci + 2] - positions[ai + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (length === 0 || nz <= 0) continue;

    const light = Math.max(0, (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / length);
    triangles.push({
      ax: center + positions[ai] * scale,
      ay: center - positions[ai + 1] * scale,
      bx: center + positions[bi] * scale,
      by: center - positions[bi + 1] * scale,
      cx: center + positions[ci] * scale,
      cy: center - positions[ci + 1] * scale,
      depth: (positions[ai + 2] + positions[bi + 2] + positions[ci + 2]) / 3,
      brightness: 0.45 + light * 0.55,
    });
  }
  return triangles;
}

function shadedColor(brightness: number): string {
  return `rgb(${Math.round(COLOR.r * brightness)}, ${Math.round(COLOR.g * brightness)}, ${Math.round(COLOR.b * brightness)})`;
}
