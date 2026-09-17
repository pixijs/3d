import { clampSegments } from './clampSegments';

/**
 * Raw vertex/index arrays produced by `buildCylinderBuffers`
 * @internal
 */
interface CylinderBuffers {
  /** Interleaved-free VEC3 positions, one triple per vertex */
  positions: Float32Array;
  /** Per-vertex VEC3 normals matching `positions` */
  normals: Float32Array;
  /** Per-vertex VEC2 UVs matching `positions` */
  uvs: Float32Array;
  /** Triangle-list indices; widened to `Uint32Array` automatically when vertex count exceeds 65 536 */
  indices: Uint16Array | Uint32Array;
}

/**
 * Builds the position/normal/UV/index buffers for a Y-axis aligned cylinder centered on the origin
 *
 * The shared backbone for `CylinderGeometry` and `ConeGeometry`. When `radiusTop === 0` or
 * `radiusBottom === 0`, the matching pole collapses to a single apex and the redundant cap is
 * omitted. Not intended for direct user consumption; build a `CylinderGeometry` or `ConeGeometry`
 * instead.
 * @param radiusTop - Radius of the top ring (apex collapses when 0).
 * @param radiusBottom - Radius of the bottom ring (apex collapses when 0).
 * @param height - Total height along Y; the mesh extends from `-height/2` to `+height/2`.
 * @param rawRadialSegments - Requested number of segments around the circumference (clamped to `>= 3`).
 * @param rawHeightSegments - Requested number of segments along Y (clamped to `>= 1`).
 * @param openEnded - When true, the top and bottom caps are omitted.
 * @returns The packed cylinder buffers.
 * @internal
 */
export function buildCylinderBuffers(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  rawRadialSegments: number,
  rawHeightSegments: number,
  openEnded: boolean,
): CylinderBuffers {
  const radialSegments = clampSegments(rawRadialSegments, 3);
  const heightSegments = clampSegments(rawHeightSegments, 1);

  const halfHeight = height * 0.5;
  const slope = (radiusBottom - radiusTop) / height;
  const normalLength = Math.sqrt(1 + slope * slope);
  const invNormalLength = 1 / normalLength;
  const slopeNormal = slope * invNormalLength;

  const invRadial = 1 / radialSegments;
  const invHeight = 1 / heightSegments;
  const radialStride = radialSegments + 1;

  const sinTable = new Float32Array(radialStride);
  const cosTable = new Float32Array(radialStride);
  const angleStep = Math.PI * 2 * invRadial;
  for (let i = 0; i < radialStride; i++) {
    const theta = i * angleStep;
    sinTable[i] = Math.sin(theta);
    cosTable[i] = Math.cos(theta);
  }

  const topApex = radiusTop === 0;
  const bottomApex = radiusBottom === 0;

  const sideVertCount = radialStride * (heightSegments + 1);
  const fullSideIndexCount = radialSegments * heightSegments * 6;
  const apexSavings = (topApex ? radialSegments * 3 : 0) + (bottomApex ? radialSegments * 3 : 0);
  const sideIndexCount = fullSideIndexCount - apexSavings;

  const hasTopCap = !openEnded && !topApex;
  const hasBottomCap = !openEnded && !bottomApex;
  const topCapVertCount = hasTopCap ? radialStride + 1 : 0;
  const bottomCapVertCount = hasBottomCap ? radialStride + 1 : 0;
  const topCapIndexCount = hasTopCap ? radialSegments * 3 : 0;
  const bottomCapIndexCount = hasBottomCap ? radialSegments * 3 : 0;

  const vertCount = sideVertCount + topCapVertCount + bottomCapVertCount;
  const indexCount = sideIndexCount + topCapIndexCount + bottomCapIndexCount;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const IndexArray = vertCount > 65536 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(indexCount);

  let pi = 0;
  let ni = 0;
  let ui = 0;
  let ii = 0;

  for (let y = 0; y <= heightSegments; y++) {
    const v = y * invHeight;
    const radius = v * (radiusBottom - radiusTop) + radiusTop;
    const posY = halfHeight - v * height;

    for (let x = 0; x <= radialSegments; x++) {
      const u = x * invRadial;
      const sinTheta = sinTable[x];
      const cosTheta = cosTable[x];

      positions[pi++] = radius * cosTheta;
      positions[pi++] = posY;
      positions[pi++] = radius * sinTheta;

      normals[ni++] = cosTheta * invNormalLength;
      normals[ni++] = slopeNormal;
      normals[ni++] = sinTheta * invNormalLength;

      uvs[ui++] = u;
      uvs[ui++] = v;
    }
  }

  for (let y = 0; y < heightSegments; y++) {
    const apexAtTop = topApex && y === 0;
    const apexAtBottom = bottomApex && y === heightSegments - 1;

    for (let x = 0; x < radialSegments; x++) {
      const a = y * radialStride + x;
      const b = a + 1;
      const c = a + radialStride;
      const d = c + 1;

      if (!apexAtTop) {
        indices[ii++] = a;
        indices[ii++] = b;
        indices[ii++] = c;
      }
      if (!apexAtBottom) {
        indices[ii++] = b;
        indices[ii++] = d;
        indices[ii++] = c;
      }
    }
  }

  if (hasTopCap) {
    const centerIndex = pi / 3;

    positions[pi++] = 0;
    positions[pi++] = halfHeight;
    positions[pi++] = 0;
    normals[ni++] = 0;
    normals[ni++] = 1;
    normals[ni++] = 0;
    uvs[ui++] = 0.5;
    uvs[ui++] = 0.5;

    for (let x = 0; x <= radialSegments; x++) {
      const cosTheta = cosTable[x];
      const sinTheta = sinTable[x];

      positions[pi++] = radiusTop * cosTheta;
      positions[pi++] = halfHeight;
      positions[pi++] = radiusTop * sinTheta;
      normals[ni++] = 0;
      normals[ni++] = 1;
      normals[ni++] = 0;
      uvs[ui++] = cosTheta * 0.5 + 0.5;
      uvs[ui++] = sinTheta * 0.5 + 0.5;
    }

    for (let x = 0; x < radialSegments; x++) {
      indices[ii++] = centerIndex;
      indices[ii++] = centerIndex + x + 2;
      indices[ii++] = centerIndex + x + 1;
    }
  }

  if (hasBottomCap) {
    const centerIndex = pi / 3;

    positions[pi++] = 0;
    positions[pi++] = -halfHeight;
    positions[pi++] = 0;
    normals[ni++] = 0;
    normals[ni++] = -1;
    normals[ni++] = 0;
    uvs[ui++] = 0.5;
    uvs[ui++] = 0.5;

    for (let x = 0; x <= radialSegments; x++) {
      const cosTheta = cosTable[x];
      const sinTheta = sinTable[x];

      positions[pi++] = radiusBottom * cosTheta;
      positions[pi++] = -halfHeight;
      positions[pi++] = radiusBottom * sinTheta;
      normals[ni++] = 0;
      normals[ni++] = -1;
      normals[ni++] = 0;
      uvs[ui++] = cosTheta * 0.5 + 0.5;
      uvs[ui++] = sinTheta * 0.5 + 0.5;
    }

    for (let x = 0; x < radialSegments; x++) {
      indices[ii++] = centerIndex;
      indices[ii++] = centerIndex + x + 1;
      indices[ii++] = centerIndex + x + 2;
    }
  }

  return { positions, normals, uvs, indices };
}
