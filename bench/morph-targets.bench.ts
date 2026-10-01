/**
 * `morph-targets`: what blend shapes cost. 144 spheres of 8,385 vertices each (1.2 million vertices a frame), every
 * one with its own weights, over one geometry carrying T position-only morph targets (`t0`, `t4`, `t16`). `t0` is
 * the same sphere with no targets, the unmorphed baseline; each rung above it adds targets, and with each one a delta
 * per vertex to fetch and sum.
 *
 * Every weight moves every frame and never reaches 0, so no target can be skipped as idle and every rung does the
 * work its count says. Each target's reach is divided by T, so the spheres cover the same pixels on every rung and
 * the fragment work stays put while the vertex work scales.
 *
 * Judged on `gpu.frame`, the vertex work the targets add. `cpu.render` beside it carries getting the weights to the
 * GPU; `update` is the copy of each mesh's weights in, which is how an app drives them.
 */

import { Geometry3D, Material3D, Mesh3D } from '@pixi/3d';
import type { View3D } from '@pixi/3d';
import type { FrameStage, Rng } from 'benchy';
import { frame } from 'benchy';

const COLUMNS = 16;
const ROWS = 9;
const SPACING = 3.9;
const RADIUS = 1.5;
const WIDTH_SEGMENTS = 128;
const HEIGHT_SEGMENTS = 64;

/** How far all of a sphere's targets together can push a vertex out, whatever their count. */
const TOTAL_REACH = 0.6;

/** A UV sphere and its outward bumps: `targets` position deltas along the normal, each a band pattern of its own. */
function morphedSphere(targets: number, rng: Rng): Geometry3D {
  const vertices = (WIDTH_SEGMENTS + 1) * (HEIGHT_SEGMENTS + 1);
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const indices = new Uint32Array(WIDTH_SEGMENTS * HEIGHT_SEGMENTS * 6);
  const deltas = Array.from({ length: targets }, () => new Float32Array(vertices * 3));
  const bands = Array.from({ length: targets }, () => ({
    around: 1 + rng.int(6),
    along: 1 + rng.int(4),
    phase: rng.range(0, Math.PI * 2),
  }));
  const reach = targets > 0 ? TOTAL_REACH / targets : 0;

  for (let row = 0, vertex = 0; row <= HEIGHT_SEGMENTS; row++) {
    const v = row / HEIGHT_SEGMENTS;
    const theta = v * Math.PI;
    for (let column = 0; column <= WIDTH_SEGMENTS; column++, vertex++) {
      const u = column / WIDTH_SEGMENTS;
      const phi = u * Math.PI * 2;
      const nx = -Math.cos(phi) * Math.sin(theta);
      const ny = Math.cos(theta);
      const nz = Math.sin(phi) * Math.sin(theta);
      positions.set([nx * RADIUS, ny * RADIUS, nz * RADIUS], vertex * 3);
      normals.set([nx, ny, nz], vertex * 3);
      uvs.set([u, 1 - v], vertex * 2);
      for (let target = 0; target < targets; target++) {
        const band = bands[target];
        const delta = deltas[target];
        if (!band || !delta) continue;
        const bump = reach * Math.abs(Math.sin(band.around * phi + band.phase) * Math.sin(band.along * theta));
        delta.set([nx * bump, ny * bump, nz * bump], vertex * 3);
      }
    }
  }

  for (let row = 0, at = 0; row < HEIGHT_SEGMENTS; row++) {
    for (let column = 0; column < WIDTH_SEGMENTS; column++, at += 6) {
      const a = row * (WIDTH_SEGMENTS + 1) + column;
      const b = a + WIDTH_SEGMENTS + 1;
      indices.set([a, b, a + 1, b, b + 1, a + 1], at);
    }
  }

  return new Geometry3D({
    positions,
    normals,
    uvs,
    indices,
    morphTargets: targets > 0 ? deltas.map((delta) => ({ positions: delta })) : undefined,
  });
}

frame('morph-targets', {
  variants: { t0: { targets: 0 }, t4: { targets: 4 }, t16: { targets: 16 } },
  primary: 'gpu.frame',
  gate: 'strict',
  antialias: false,
  options: { cull: 'off' },
  create({ view, rng }: FrameStage<{ view: View3D }>, { targets }) {
    const geometry = morphedSphere(targets, rng);
    const material = new Material3D({ baseColor: [0.8, 0.55, 0.45], roughness: 0.5, metallic: 0 });
    const count = COLUMNS * ROWS;
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.set(
        ((i % COLUMNS) - (COLUMNS - 1) / 2) * SPACING,
        (Math.floor(i / COLUMNS) - (ROWS - 1) / 2) * SPACING,
        0,
      );
      meshes.push(view.root.addChild(mesh));
    }

    // Each weight is a slow wave of its own, kept in [0.1, 1] so no target is ever skipped.
    const weights = new Float32Array(count * targets);
    const rates = Float32Array.from({ length: weights.length }, () => rng.range(0.5, 3));
    const phases = Float32Array.from({ length: weights.length }, () => rng.range(0, Math.PI * 2));
    const slices = meshes.map((_, i) => weights.subarray(i * targets, (i + 1) * targets));

    return {
      simulate(seconds) {
        for (let i = 0; i < weights.length; i++) {
          weights[i] = 0.55 + 0.45 * Math.sin((rates[i] ?? 0) * seconds + (phases[i] ?? 0));
        }
      },
      update() {
        if (targets === 0) return;
        for (let i = 0; i < count; i++) meshes[i]?.weights?.set(slices[i] ?? weights);
      },
      destroy() {
        geometry.destroy(true);
        material.destroy();
      },
    };
  },
});
