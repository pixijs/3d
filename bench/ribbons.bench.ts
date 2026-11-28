/**
 * `ribbons`: what a `RibbonGeometry` costs, on the CPU when it is built and moved, and on the GPU where its vertex
 * shader turns the strip to the camera.
 *
 * The cpu benches run in Node. A build makes new geometries from the same points: one long line with a width and a
 * colour per point, then the same points as many short lines, the shape hair and fibres take. A sample is 256 builds
 * back to back, because benchy collects before every sample and a forced collection makes V8 drop the constructor's
 * optimised code: one build a sample times the interpreter running the constructor's loops, 0.5 ms a build against
 * 0.09 ms warm, and ranks a change by how much of it sits in the constructor. `setPoints` moves a `dynamic` ribbon's
 * points, as a trail does every frame, so it is the bench whose `alloc/op` has to read as nothing of its own: the
 * 384 B it does read is pixi's emitter, six `emit` calls whose `arguments` object costs 64 B each until V8 optimises
 * `emit`. Each snapshot folds every buffer the call wrote, so a change in what a ribbon holds shows as a changed
 * snapshot rather than as a faster run.
 *
 * The gpu benches draw one static frame of thin curls filling the view, a million points in the first rung, lit so
 * the cord normal the shader writes is read. The curls are two pixels wide and each segment under a pixel long, so
 * the frame's GPU time is its vertices and triangles, not its fill; the smaller rung shows how far it follows the
 * count. One bench per width unit, since each has its own shader bit. The mesh is turned and squashed so a world
 * width goes through the scale it divides by.
 */

// The extras entry needs the core entry evaluated first; in Node, where the cpu benches run, nothing else loads it
// before this file does.
import { Material3D, Mesh3D } from '@pixi/3d';
import { RibbonGeometry } from '@pixi/3d/extras';
import type { RibbonWidthUnits } from '@pixi/3d/extras';
import { cpu, gpu } from 'benchy';
import type { TypedArray } from 'pixi.js';

import { rng } from './data/rng.ts';
import type { PixiStage } from './stage.ts';

/** Points a cpu bench builds or moves: a long trail, or a head of short fibres. */
const CPU_POINTS = 4096;

/** Builds in one sample of a build bench. */
const BUILDS = 256;

/** Points in each curl of the gpu scene, and how long, wide and tightly wound a curl is, in world units. */
const CURL_POINTS = 256;
const CURL_LENGTH = 3;
const CURL_RADIUS = 0.4;
const CURL_TURNS = 3;

/** Half the box the curls' centres fill, which the camera at (0, 0, 40) sees whole. */
const FIELD: [number, number, number] = [28, 14, 8];

/** A two-pixel width in each unit, at the 29 pixels a world unit spans at the origin. */
const WIDTHS: Record<RibbonWidthUnits, number> = { world: 0.07, pixels: 2 };

/**
 * `lines` curls of `perLine` points each, one after another: each a helix about a random axis through a random
 * centre in `extent`, so the lines meet the camera at every angle.
 */
function curls(lines: number, perLine: number, extent: readonly [number, number, number], seed: number): Float32Array {
  const random = rng(seed);
  const points = new Float32Array(lines * perLine * 3);
  const axis = [0, 0, 0];
  const side = [0, 0, 0];

  for (let l = 0; l < lines; l++) {
    const cx = random.range(-extent[0], extent[0]);
    const cy = random.range(-extent[1], extent[1]);
    const cz = random.range(-extent[2], extent[2]);
    random.unit(axis);
    random.unit(side);
    // `side` made square to `axis`, then `up` square to both.
    const along = side[0] * axis[0] + side[1] * axis[1] + side[2] * axis[2];
    let sx = side[0] - axis[0] * along;
    let sy = side[1] - axis[1] * along;
    let sz = side[2] - axis[2] * along;
    const length = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= length;
    sy /= length;
    sz /= length;
    const ux = axis[1] * sz - axis[2] * sy;
    const uy = axis[2] * sx - axis[0] * sz;
    const uz = axis[0] * sy - axis[1] * sx;

    for (let i = 0; i < perLine; i++) {
      const t = i / (perLine - 1);
      const angle = t * CURL_TURNS * Math.PI * 2;
      const forward = (t - 0.5) * CURL_LENGTH;
      const c = Math.cos(angle) * CURL_RADIUS;
      const s = Math.sin(angle) * CURL_RADIUS;
      const at = (l * perLine + i) * 3;
      points[at] = cx + axis[0] * forward + sx * c + ux * s;
      points[at + 1] = cy + axis[1] * forward + sy * c + uy * s;
      points[at + 2] = cz + axis[2] * forward + sz * c + uz * s;
    }
  }

  return points;
}

/** A sum that weights each value by its place, so two values swapped change it. */
function fold(data: TypedArray | number[]): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * ((i % 13) + 1);
  return sum;
}

/** Every buffer a build or a `setPoints` writes, folded, and the bounds. */
function digest(ribbon: RibbonGeometry): number[] {
  const { aPosition, aRibbon, aUV, aColor } = ribbon.attributes;
  const { min, max } = ribbon.bounds3D;
  return [
    fold(aPosition.buffer.data),
    fold(aRibbon.buffer.data),
    fold(aUV.buffer.data),
    aColor ? fold(aColor.buffer.data) : 0,
    fold(ribbon.indices),
    min.x,
    min.y,
    min.z,
    max.x,
    max.y,
    max.z,
  ];
}

function taperedWidths(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, i) => 0.05 + 0.2 * Math.sin((i / (count - 1)) * Math.PI));
}

function gradientColors(count: number): Float32Array {
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([1, i / count, 0.4, 1], i * 4);
  return colors;
}

cpu('256 ribbon builds, one line of 4096 points', function* () {
  const points = curls(1, CPU_POINTS, [0, 0, 0], 0x71bb_0001);
  const width = taperedWidths(CPU_POINTS);
  const colors = gradientColors(CPU_POINTS);
  let built = new RibbonGeometry({ points, width, colors });
  yield {
    bench: () => {
      for (let i = 0; i < BUILDS; i++) built = new RibbonGeometry({ points, width, colors });
      return built.vertexCount;
    },
    snapshot: () => digest(built),
  };
});

cpu('256 ribbon builds, 1024 lines of 4 points', function* () {
  const points = curls(CPU_POINTS / 4, 4, [4, 4, 4], 0x71bb_0002);
  let built = new RibbonGeometry({ points, pointsPerLine: 4 });
  yield {
    bench: () => {
      for (let i = 0; i < BUILDS; i++) built = new RibbonGeometry({ points, pointsPerLine: 4 });
      return built.vertexCount;
    },
    snapshot: () => digest(built),
  };
});

cpu('ribbon setPoints, one line of 4096 points', function* () {
  const points = curls(1, CPU_POINTS, [0, 0, 0], 0x71bb_0003);
  const ribbon = new RibbonGeometry({ points: new Float32Array(CPU_POINTS * 3), dynamic: true });
  yield {
    bench: () => {
      ribbon.setPoints(points);
      return ribbon.vertexCount;
    },
    snapshot: () => digest(ribbon),
  };
});

cpu('ribbon setPoints, 64 lines of 64 points', function* () {
  const points = curls(64, 64, [4, 4, 4], 0x71bb_0004);
  const ribbon = new RibbonGeometry({ points: new Float32Array(CPU_POINTS * 3), pointsPerLine: 64, dynamic: true });
  yield {
    bench: () => {
      ribbon.setPoints(points);
      return ribbon.vertexCount;
    },
    snapshot: () => digest(ribbon),
  };
});

function curlField({ view }: PixiStage, widthUnits: RibbonWidthUnits, lines: number): { destroy(): void } {
  const geometry = new RibbonGeometry({
    points: curls(lines, CURL_POINTS, FIELD, 0x71bb_0005),
    pointsPerLine: CURL_POINTS,
    width: WIDTHS[widthUnits],
    widthUnits,
  });
  const material = new Material3D({ baseColor: 0xe7_22_64, roughness: 0.6 });
  const mesh = new Mesh3D({ geometry, material, parent: view.root });
  mesh.rotation.z = 0.25;
  mesh.scale.set(1, 0.8, 1.3);

  return {
    destroy() {
      material.destroy();
      geometry.destroy(true);
    },
  };
}

gpu('ribbon shader, world widths', {
  variants: { c1m: { lines: 4096 }, c250k: { lines: 1024 } },
  gate: 'strict',
  antialias: false,
  options: { cull: 'off' },
  create(stage: PixiStage, { lines }) {
    return curlField(stage, 'world', lines);
  },
});

gpu('ribbon shader, pixel widths', {
  variants: { c1m: { lines: 4096 }, c250k: { lines: 1024 } },
  gate: 'strict',
  antialias: false,
  options: { cull: 'off' },
  create(stage: PixiStage, { lines }) {
    return curlField(stage, 'pixels', lines);
  },
});
