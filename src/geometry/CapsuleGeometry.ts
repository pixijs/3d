import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { clampSegments } from './utils/clampSegments';

/**
 * Options for {@link CapsuleGeometry}
 * @category geometry
 * @standard
 */
export interface CapsuleGeometryOptions extends Geometry3DOptions {
  /**
   * The radius of the capsule, shared by the cylindrical mid-section and the hemispherical caps
   * @default 0.5
   */
  radius: number;
  /**
   * The total height of the capsule along the Y axis, including the caps
   *
   * The cylindrical portion is `height - 2 * radius` (clamped to `>= 0`); when
   * `height <= 2 * radius` the result degenerates into a sphere.
   * @default 2
   */
  height: number;
  /**
   * The number of segments around the circumference
   *
   * Clamped to a minimum of 3; fewer would collapse the ring into a degenerate shape. Cap detail
   * is derived from this as `ceil(radialSegments / 2)`.
   * @default 32
   */
  radialSegments: number;
  /**
   * The number of segments along the cylindrical portion only; the hemispherical caps tessellate
   * independently
   *
   * Clamped to a minimum of 1.
   * @default 8
   */
  heightSegments: number;
}

/**
 * A capsule geometry oriented along the +Y axis and centered on the origin: a cylindrical
 * mid-section with hemispherical caps on each end
 *
 * The total `height` includes the caps, so the cylindrical portion measures `height - 2 * radius`
 * (clamped to `>= 0`); top sits at `+height/2` and bottom at `-height/2`.
 *
 * Normals are smooth across the cylinder/cap seam. UVs wrap once around the circumference
 * (`u` in `[0, 1]`) and run from bottom to top in `v`, with the bottom cap, cylinder, and top cap
 * each occupying a slice of `v` proportional to their height contribution.
 * @example
 * ```ts
 * const capsule = new CapsuleGeometry({
 *   radius: 0.5,
 *   height: 2,
 *   radialSegments: 32,
 *   heightSegments: 8,
 * });
 * ```
 * @see {@link Geometry3D} For the base geometry class
 * @see {@link Geometry3DOptions} For inherited geometry options
 * @see {@link CylinderGeometry} For the same primitive without rounded caps
 * @see {@link ConeGeometry} For a cylinder with `radiusTop = 0`
 * @category geometry
 * @standard
 */
export class CapsuleGeometry extends Geometry3D {
  /** Default options for {@link CapsuleGeometry} */
  public static defaultOptions: CapsuleGeometryOptions = {
    ...Geometry3D.defaultOptions,
    radius: 0.5,
    height: 2,
    radialSegments: 32,
    heightSegments: 8,
  };

  /**
   * Creates a new `CapsuleGeometry`
   * @param options - See {@link CapsuleGeometryOptions} for available options
   */
  constructor(options: Partial<CapsuleGeometryOptions> = {}) {
    const resolvedOptions = {
      ...CapsuleGeometry.defaultOptions,
      ...options,
    };
    const { radius, height } = resolvedOptions;
    const radialSegments = clampSegments(resolvedOptions.radialSegments, 3);
    const heightSegments = clampSegments(resolvedOptions.heightSegments, 1);
    const capSegments = Math.max(1, Math.ceil(radialSegments / 2));

    const cylinderHeight = Math.max(0, height - 2 * radius);
    const halfCylinderHeight = cylinderHeight * 0.5;

    const totalHeight = cylinderHeight + 2 * radius;
    const invTotalHeight = 1 / totalHeight;
    const capUVHeight = radius * invTotalHeight;
    const cylinderUVHeight = cylinderHeight * invTotalHeight;

    const invRadial = 1 / radialSegments;
    const invHeight = 1 / heightSegments;
    const invCapSegments = 1 / capSegments;
    const radialStride = radialSegments + 1;

    const sinTable = new Float32Array(radialStride);
    const cosTable = new Float32Array(radialStride);
    const angleStep = Math.PI * 2 * invRadial;
    for (let i = 0; i < radialStride; i++) {
      const theta = i * angleStep;
      sinTable[i] = Math.sin(theta);
      cosTable[i] = Math.cos(theta);
    }

    const topHemiRings = capSegments;
    const bodyRings = heightSegments + 1;
    const bottomHemiRings = capSegments;
    const totalRings = topHemiRings + bodyRings + bottomHemiRings;
    const quadRows = totalRings - 1;

    const vertCount = totalRings * radialStride;
    // Skip the degenerate triangle that touches the north pole on the first row and the
    // degenerate triangle that touches the south pole on the last row.
    const indexCount = (quadRows - 1) * radialSegments * 6;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const IndexArray = vertCount > 65536 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(indexCount);

    let pi = 0;
    let ni = 0;
    let ui = 0;
    let ii = 0;

    // Top hemisphere: y = 0 .. capSegments - 1 (skip last ring; body provides the seam ring)
    for (let y = 0; y < capSegments; y++) {
      const t = y * invCapSegments;
      const phi = (1 - t) * (Math.PI / 2);
      const v = capUVHeight * t;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const ringRadius = cosPhi * radius;
      const posY = sinPhi * radius + halfCylinderHeight;

      for (let x = 0; x <= radialSegments; x++) {
        const u = x * invRadial;
        const cosTheta = cosTable[x];
        const sinTheta = sinTable[x];

        positions[pi++] = ringRadius * cosTheta;
        positions[pi++] = posY;
        positions[pi++] = ringRadius * sinTheta;

        normals[ni++] = cosPhi * cosTheta;
        normals[ni++] = sinPhi;
        normals[ni++] = cosPhi * sinTheta;

        uvs[ui++] = u;
        uvs[ui++] = v;
      }
    }

    // Cylinder body: y = 0 .. heightSegments (provides both seam rings)
    for (let y = 0; y <= heightSegments; y++) {
      const t = y * invHeight;
      const posY = halfCylinderHeight - t * cylinderHeight;
      const v = capUVHeight + t * cylinderUVHeight;

      for (let x = 0; x <= radialSegments; x++) {
        const u = x * invRadial;
        const cosTheta = cosTable[x];
        const sinTheta = sinTable[x];

        positions[pi++] = radius * cosTheta;
        positions[pi++] = posY;
        positions[pi++] = radius * sinTheta;

        normals[ni++] = cosTheta;
        normals[ni++] = 0;
        normals[ni++] = sinTheta;

        uvs[ui++] = u;
        uvs[ui++] = v;
      }
    }

    // Bottom hemisphere: y = 1 .. capSegments (skip first ring; body provides the seam ring)
    for (let y = 1; y <= capSegments; y++) {
      const t = y * invCapSegments;
      const phi = t * (Math.PI / 2);
      const v = capUVHeight + cylinderUVHeight + capUVHeight * t;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const ringRadius = cosPhi * radius;
      const posY = -sinPhi * radius - halfCylinderHeight;

      for (let x = 0; x <= radialSegments; x++) {
        const u = x * invRadial;
        const cosTheta = cosTable[x];
        const sinTheta = sinTable[x];

        positions[pi++] = ringRadius * cosTheta;
        positions[pi++] = posY;
        positions[pi++] = ringRadius * sinTheta;

        normals[ni++] = cosPhi * cosTheta;
        normals[ni++] = -sinPhi;
        normals[ni++] = cosPhi * sinTheta;

        uvs[ui++] = u;
        uvs[ui++] = v;
      }
    }

    const lastRow = quadRows - 1;
    for (let y = 0; y < quadRows; y++) {
      // The first row collapses a/b to the north pole; emit only the fan triangle (b,d,c).
      // The last row collapses c/d to the south pole; emit only the fan triangle (a,b,c).
      const skipAbc = y === 0;
      const skipBdc = y === lastRow;

      for (let x = 0; x < radialSegments; x++) {
        const a = y * radialStride + x;
        const b = a + 1;
        const c = a + radialStride;
        const d = c + 1;

        if (!skipAbc) {
          indices[ii++] = a;
          indices[ii++] = b;
          indices[ii++] = c;
        }
        if (!skipBdc) {
          indices[ii++] = b;
          indices[ii++] = d;
          indices[ii++] = c;
        }
      }
    }

    super({
      ...resolvedOptions,
      positions,
      normals,
      uvs,
      indices,
    });
  }
}
