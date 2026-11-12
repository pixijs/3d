/**
 * The geometry the field scenes draw, generated rather than loaded: eight shapes.
 *
 * Generating it is what makes the workload the same everywhere — the same vertex and triangle counts on
 * every machine, in every run, with no asset to fetch. The winding is counter-clockwise for outward faces in a
 * right-handed Y-up space, which is what PixiJS 3D expects.
 */

export interface Geometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

function make(positions: number[], normals: number[], uvs: number[], indices: number[]): Geometry {
  const vertices = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: vertices > 65_535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };
}

export function box(size = 1): Geometry {
  const half = size / 2;
  // [normal, u axis, v axis] with u × v = normal, so the corners come out counter-clockwise.
  const faces: Array<[number[], number[], number[]]> = [
    [
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, -1],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [-1, 0, 0],
      [0, 1, 0],
    ],
  ];
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [normal, u, v] of faces) {
    const base = positions.length / 3;
    for (const [su, sv] of corners) {
      for (let axis = 0; axis < 3; axis++) {
        positions.push(half * ((normal[axis] ?? 0) + su * (u[axis] ?? 0) + sv * (v[axis] ?? 0)));
      }
      normals.push(normal[0] ?? 0, normal[1] ?? 0, normal[2] ?? 0);
      uvs.push((su + 1) / 2, (sv + 1) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return make(positions, normals, uvs, indices);
}

export function sphere(radius = 0.5, widthSegments = 24, heightSegments = 16): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const at = (ix: number, iy: number): number => iy * (widthSegments + 1) + ix;
  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      const x = -radius * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI);
      const y = radius * Math.cos(v * Math.PI);
      const z = radius * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI);
      positions.push(x, y, z);
      const length = Math.hypot(x, y, z) || 1;
      normals.push(x / length, y / length, z / length);
      uvs.push(u, 1 - v);
    }
  }
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = at(ix + 1, iy);
      const b = at(ix, iy);
      const c = at(ix, iy + 1);
      const d = at(ix + 1, iy + 1);
      if (iy !== 0) indices.push(a, b, d);
      if (iy !== heightSegments - 1) indices.push(b, c, d);
    }
  }
  return make(positions, normals, uvs, indices);
}

export function cylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, radialSegments = 24): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const halfHeight = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  const side = (ring: number, segment: number): number => ring * (radialSegments + 1) + segment;
  for (let ring = 0; ring <= 1; ring++) {
    const radius = ring * (radiusBottom - radiusTop) + radiusTop;
    for (let segment = 0; segment <= radialSegments; segment++) {
      const u = segment / radialSegments;
      const theta = u * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      positions.push(radius * sin, -ring * height + halfHeight, radius * cos);
      const length = Math.hypot(sin, slope, cos);
      normals.push(sin / length, slope / length, cos / length);
      uvs.push(u, 1 - ring);
    }
  }
  for (let segment = 0; segment < radialSegments; segment++) {
    const a = side(0, segment);
    const b = side(1, segment);
    const c = side(1, segment + 1);
    const d = side(0, segment + 1);
    if (radiusTop > 0) indices.push(a, b, d);
    if (radiusBottom > 0) indices.push(b, c, d);
  }
  const cap = (top: boolean): void => {
    const radius = top ? radiusTop : radiusBottom;
    const sign = top ? 1 : -1;
    const centreStart = positions.length / 3;
    for (let segment = 1; segment <= radialSegments; segment++) {
      positions.push(0, halfHeight * sign, 0);
      normals.push(0, sign, 0);
      uvs.push(0.5, 0.5);
    }
    const rimStart = positions.length / 3;
    for (let segment = 0; segment <= radialSegments; segment++) {
      const theta = (segment / radialSegments) * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      positions.push(radius * sin, halfHeight * sign, radius * cos);
      normals.push(0, sign, 0);
      uvs.push(cos * 0.5 + 0.5, sin * 0.5 * sign + 0.5);
    }
    for (let segment = 0; segment < radialSegments; segment++) {
      const centre = centreStart + segment;
      const rim = rimStart + segment;
      if (top) indices.push(rim, rim + 1, centre);
      else indices.push(rim + 1, rim, centre);
    }
  };
  if (radiusTop > 0) cap(true);
  if (radiusBottom > 0) cap(false);
  return make(positions, normals, uvs, indices);
}

export function torus(radius = 0.35, tube = 0.15, radialSegments = 16, tubularSegments = 32): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= radialSegments; ring++) {
    for (let segment = 0; segment <= tubularSegments; segment++) {
      const u = (segment / tubularSegments) * Math.PI * 2;
      const v = (ring / radialSegments) * Math.PI * 2;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = (radius + tube * Math.cos(v)) * Math.sin(u);
      const z = tube * Math.sin(v);
      positions.push(x, y, z);
      const nx = x - radius * Math.cos(u);
      const ny = y - radius * Math.sin(u);
      const length = Math.hypot(nx, ny, z) || 1;
      normals.push(nx / length, ny / length, z / length);
      uvs.push(segment / tubularSegments, ring / radialSegments);
    }
  }
  for (let ring = 1; ring <= radialSegments; ring++) {
    for (let segment = 1; segment <= tubularSegments; segment++) {
      const a = (tubularSegments + 1) * ring + segment - 1;
      const b = (tubularSegments + 1) * (ring - 1) + segment - 1;
      const c = (tubularSegments + 1) * (ring - 1) + segment;
      const d = (tubularSegments + 1) * ring + segment;
      indices.push(a, b, d, b, c, d);
    }
  }
  return make(positions, normals, uvs, indices);
}

/** Flat-shaded polyhedron from unit-sphere vertices and counter-clockwise faces, scaled to `radius`. */
function polyhedron(vertices: number[], faces: number[], radius: number): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexAt = (index: number): [number, number, number] => {
    const x = vertices[index * 3] ?? 0;
    const y = vertices[index * 3 + 1] ?? 0;
    const z = vertices[index * 3 + 2] ?? 0;
    const length = Math.hypot(x, y, z) || 1;
    return [(x / length) * radius, (y / length) * radius, (z / length) * radius];
  };
  for (let face = 0; face < faces.length; face += 3) {
    const a = vertexAt(faces[face] ?? 0);
    const b = vertexAt(faces[face + 1] ?? 0);
    const c = vertexAt(faces[face + 2] ?? 0);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      (e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0),
      (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0),
      (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0),
    ];
    const length = Math.hypot(normal[0] ?? 0, normal[1] ?? 0, normal[2] ?? 0) || 1;
    const base = positions.length / 3;
    for (const point of [a, b, c]) {
      positions.push(point[0], point[1], point[2]);
      normals.push((normal[0] ?? 0) / length, (normal[1] ?? 0) / length, (normal[2] ?? 0) / length);
    }
    uvs.push(0, 0, 1, 0, 0.5, 1);
    indices.push(base, base + 1, base + 2);
  }
  return make(positions, normals, uvs, indices);
}

export function icosahedron(radius = 0.5): Geometry {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    -1,
    t,
    0,
    1,
    t,
    0,
    -1,
    -t,
    0,
    1,
    -t,
    0,
    0,
    -1,
    t,
    0,
    1,
    t,
    0,
    -1,
    -t,
    0,
    1,
    -t,
    t,
    0,
    -1,
    t,
    0,
    1,
    -t,
    0,
    -1,
    -t,
    0,
    1,
  ];
  const faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2,
    3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  return polyhedron(vertices, faces, radius);
}

export function octahedron(radius = 0.5): Geometry {
  const vertices = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
  const faces = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2];
  return polyhedron(vertices, faces, radius);
}

/** The eight shapes a field scene picks from, in a fixed order so a seed names the same scene. */
export function fieldGeometries(): Geometry[] {
  return [
    box(),
    sphere(0.5, 24, 16),
    cylinder(0.5, 0.5, 1, 24),
    cylinder(0, 0.5, 1, 24),
    torus(),
    icosahedron(),
    octahedron(),
    sphere(0.5, 8, 6),
  ];
}

/**
 * `count` distinct geometries: geometry `i` is the field's shape `i % 8` at the field's own segment counts, bent by a
 * smooth radial scale keyed by `i`, so two of one shape still differ and each is a vertex buffer of its own, while
 * the vertex load stays the field's.
 */
export function geometryVariants(count: number): Geometry[] {
  const shapes = fieldGeometries();
  const out: Geometry[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = shapes[i % shapes.length];
    const a = 2 + (i % 7);
    const b = 3 + (i % 5);
    const c = i * 0.7;
    const positions = new Float32Array(geometry.positions);
    for (let at = 0; at < positions.length; at += 3) {
      const scale = 1 + 0.12 * Math.sin(a * (positions[at] ?? 0) + c) * Math.sin(b * (positions[at + 1] ?? 0) - c);
      positions[at] = (positions[at] ?? 0) * scale;
      positions[at + 1] = (positions[at + 1] ?? 0) * scale;
      positions[at + 2] = (positions[at + 2] ?? 0) * scale;
    }
    out.push({ ...geometry, positions });
  }
  return out;
}
