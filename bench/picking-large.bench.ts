/**
 * `picking-large`: `View3D.raycast` over thousands of interactive meshes, 8 casts a frame, judged on `cpu.update`,
 * where the casts run. The pick list is visited in the order the meshes joined it, so `order` decides how often a
 * nearer hit is already known when a mesh comes up.
 *
 * - `column-*`: 2048 cubes stacked along the view axis, so every cast passes every mesh's broadphase and hits all
 *   of them. `far-first` makes each mesh a new nearest hit, so nothing can be skipped; `near-first` finds the
 *   nearest hit first; `shuffled` is in between.
 * - `field`: 4096 cubes on a 32 × 16 × 8 grid over the view, shuffled, cast over the whole of it; most casts hit
 *   and pass the broadphase of a handful of meshes.
 * - `sparse`: the same field with cubes a quarter of the spacing wide, so most casts hit nothing.
 * - `cards-far-first`: the column with 2-triangle planes in place of cubes, the cheapest triangle loop there is.
 * - `rings`: a backdrop joins the list first, then 2048 low-poly rings stacked along the view axis that every cast
 *   threads through the hole of: each ring's bounds are entered nearer than the backdrop and its triangles all miss.
 *
 * `volume` is the hit volume: `geometry` (12 triangles a cube, 48 a ring), the default bounds `box`, or a `sphere`.
 */

import { CubeGeometry, Material3D, Mesh3D, PlaneGeometry, Sphere, TorusGeometry, Vector3 } from '@pixi/3d';
import type { Geometry3D } from '@pixi/3d';
import { frame } from 'benchy';
import type { Rng } from 'benchy';

import type { PixiStage } from './stage.ts';

const CASTS = 8;
const FRAMES = 60;
const COLUMN_NEAR = 20;
const COLUMN_FAR = -40;

function shuffledOrder(count: number, order: string, rng: Rng): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  if (order === 'near-first') indices.reverse();
  if (order === 'shuffled') {
    for (let i = count - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const swap = indices[i]!;
      indices[i] = indices[j]!;
      indices[j] = swap;
    }
  }
  return indices;
}

frame('picking-large', {
  variants: {
    'column-far-first': { layout: 'column', order: 'far-first', volume: 'geometry' },
    'column-near-first': { layout: 'column', order: 'near-first', volume: 'geometry' },
    'column-shuffled': { layout: 'column', order: 'shuffled', volume: 'geometry' },
    field: { layout: 'field', order: 'shuffled', volume: 'geometry' },
    sparse: { layout: 'sparse', order: 'shuffled', volume: 'geometry' },
    'cards-far-first': { layout: 'cards', order: 'far-first', volume: 'geometry' },
    rings: { layout: 'rings', order: 'far-first', volume: 'geometry' },
    'box-column-far-first': { layout: 'column', order: 'far-first', volume: 'box' },
    'box-field': { layout: 'field', order: 'shuffled', volume: 'box' },
    'sphere-column-far-first': { layout: 'column', order: 'far-first', volume: 'sphere' },
    'sphere-field': { layout: 'field', order: 'shuffled', volume: 'sphere' },
  },
  primary: 'cpu.update',
  create({ view, rng }: PixiStage, { layout, order, volume }) {
    const camera = view.camera;
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const pixelsPerTan = view.height / 2 / tanHalf;
    const aspect = view.width / view.height;
    const material = new Material3D({ baseColor: 0x4f9ed9 });
    const geometries: Geometry3D[] = [];

    const addMesh = (geometry: Geometry3D, x: number, y: number, z: number, scale: number, ring: boolean): void => {
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.set(x, y, z);
      mesh.scale.set(scale);
      if (ring) mesh.rotation.set(Math.PI / 2, 0, 0);
      mesh.eventMode = 'static';
      if (volume === 'geometry') mesh.hitVolume = 'geometry';
      if (volume === 'sphere') mesh.hitVolume = new Sphere(new Vector3(), Math.sqrt(3) / 2);
      view.root.addChild(mesh);
    };

    const points: { x: number; y: number }[] = [];
    const castWithin = (tanX: number, tanY: number): void => {
      for (let i = 0; i < CASTS * FRAMES; i++) {
        points.push({
          x: view.width / 2 + rng.range(-tanX, tanX) * pixelsPerTan,
          y: view.height / 2 + rng.range(-tanY, tanY) * pixelsPerTan,
        });
      }
    };

    if (layout === 'column' || layout === 'cards' || layout === 'rings') {
      const count = 2048;
      const size = layout === 'rings' ? 1 : 4;
      const geometry =
        layout === 'column'
          ? new CubeGeometry({ width: 1, height: 1, depth: 1 })
          : layout === 'cards'
            ? new PlaneGeometry({ width: 1, height: 1 })
            : new TorusGeometry({ radius: 1.5, tube: 0.3, radialSegments: 3, tubularSegments: 8 });
      geometries.push(geometry);
      if (layout === 'rings') {
        const backdrop = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        geometries.push(backdrop);
        const mesh = new Mesh3D({ geometry: backdrop, material, castShadow: false, receiveShadow: false });
        mesh.position.set(0, 0, COLUMN_FAR - 20);
        mesh.scale.set(20);
        mesh.eventMode = 'static';
        mesh.hitVolume = 'geometry';
        view.root.addChild(mesh);
      }
      for (const i of shuffledOrder(count, order, rng)) {
        addMesh(geometry, 0, 0, COLUMN_FAR + ((COLUMN_NEAR - COLUMN_FAR) * i) / (count - 1), size, layout === 'rings');
      }
      const reach = layout === 'rings' ? 0.008 : 0.012;
      castWithin(reach, reach);
    } else {
      const cols = 32;
      const rows = 16;
      const layers = 8;
      const halfHeight = camera.position.z * tanHalf;
      const spacing = Math.min((1.8 * halfHeight * aspect) / cols, (1.8 * halfHeight) / rows);
      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      geometries.push(geometry);
      const size = spacing * (layout === 'sparse' ? 0.25 : 0.8);
      for (const i of shuffledOrder(cols * rows * layers, order, rng)) {
        const col = i % cols;
        const row = Math.floor(i / cols) % rows;
        const layer = Math.floor(i / (cols * rows));
        addMesh(
          geometry,
          (col - (cols - 1) / 2) * spacing,
          (row - (rows - 1) / 2) * spacing,
          (layer - (layers - 1) / 2) * spacing,
          size,
          false,
        );
      }
      castWithin(0.9 * tanHalf * aspect, 0.9 * tanHalf);
    }

    let first = 0;

    return {
      simulate(seconds) {
        first = (Math.round(seconds * 60) % FRAMES) * CASTS;
      },
      update() {
        const end = first + CASTS;
        for (let i = first; i < end; i++) view.raycast(points[i]!);
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy();
        material.destroy();
      },
    };
  },
});
