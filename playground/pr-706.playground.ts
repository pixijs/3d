import { CubeGeometry, DirectionalLight, Material3D, Mesh3D, SphereGeometry, View3D } from '@pixi/3d';
import type { BaseMaterial3D, Geometry3D } from '@pixi/3d';
import { Application, CanvasSource, Color, Text, Texture } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

const COLUMNS = 30;
const GRID_ROWS = 12;
const TOP = 12;
const KEY_BATCH = 10;
const BURST = 70;
const LEGEND_REFRESH_MS = 250;

function solidTexture(color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 2, 2);

  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function pickRandom<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const picked = Math.min(count, pool.length);

  for (let i = 0; i < picked; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, picked);
}

interface Shown {
  mesh: Mesh3D;
  /** Grid slot the mesh sits in, or -1 for a mesh pinned off to the side */
  slot: number;
}

/**
 * PR #706: draw commands own their members, so a mesh added or removed between frames edits the
 * draw list and doesn't rebuild it.
 *
 * A lit grid of cubes and spheres in four materials. The eight meshes on the right, one per kind,
 * stay for the whole run, so a kind's draw command outlives the grid's meshes. Added meshes fill
 * the holes first, then the empty rows under the grid.
 *
 * - A: add 10 meshes of kinds already drawn
 * - N: add a mesh of a new kind, with its own material and solid colour texture
 * - B: add 70 new kinds in one frame, past the 64 tail commands a list holds
 * - R: remove 10 random grid meshes
 * - H: flip `visible` on a random 10 % of the grid
 * - M: give 10 random grid meshes another existing material
 * - T: change every material's `baseColor` in place
 *
 * What to look for:
 *
 * - Each key shows on the next frame, and nothing flickers on the frames after it.
 * - 60 frames after N, the list folds the new kind's command into its sorted ones. Nothing on screen
 *   may change on that frame.
 * - B goes past the cap, so the list rebuilds at once and there's no fold to wait for.
 * - "worst" in the legend is the slowest frame since the last key press, which is where a rebuild
 *   shows.
 *
 * Compare `renderer=webgpu` with `renderer=webgl`.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x10141a });
  document.body.appendChild(app.canvas);

  const view3d = new View3D({
    autoResize: true,
    environment: { skyColor: 0xdfe8f2, groundColor: 0x30281f },
  });
  app.stage.addChild(view3d);
  view3d.camera.fov = 50;
  view3d.camera.position.set(0, 0, 30);

  const sun = new DirectionalLight({ intensity: 2.5 });
  sun.position.set(5, 8, 12);
  sun.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(sun);

  const geometries: Geometry3D[] = [
    new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 }),
    new SphereGeometry({ radius: 0.45 }),
  ];
  const materials = [0xe0533d, 0x2b6cb0, 0xf2b134, 0x4ed95c].map(
    (baseColor) => new Material3D({ baseColor, roughness: 0.5 }),
  );

  const shown: Shown[] = [];
  const freeSlots: number[] = [];
  let nextSlot = 0;

  function addMesh(geometry: Geometry3D, material: BaseMaterial3D): void {
    const slot = freeSlots.pop() ?? nextSlot++;
    const mesh = new Mesh3D({ geometry, material });

    mesh.position.set((slot % COLUMNS) - (COLUMNS - 1) / 2, TOP - Math.floor(slot / COLUMNS), 0);
    view3d.root.addChild(mesh);
    shown.push({ mesh, slot });
  }

  function gridMeshes(): Shown[] {
    return shown.filter(({ slot }) => slot >= 0);
  }

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      addMesh(geometries[column % 2], materials[(column + row) % materials.length]);
    }
  }

  materials.forEach((material, m) => {
    geometries.forEach((geometry, g) => {
      const mesh = new Mesh3D({ geometry, material });

      mesh.position.set(18 + g * 1.5, TOP - m * 1.5, 0);
      view3d.root.addChild(mesh);
      shown.push({ mesh, slot: -1 });
    });
  });

  let hue = 0;

  function addNewKind(): void {
    hue = (hue + 137.508) % 360;
    const colour = new Color({ h: hue, s: 85, l: 55 }).toHex();
    const material = new Material3D({ baseColorTexture: solidTexture(colour), roughness: 0.5 });

    materials.push(material);
    addMesh(geometries[materials.length % 2], material);
  }

  const actions: Record<string, () => void> = {
    a: () => {
      for (const { mesh } of pickRandom(shown, KEY_BATCH)) {
        addMesh(mesh.geometry, mesh.material);
      }
    },
    n: addNewKind,
    b: () => {
      for (let i = 0; i < BURST; i++) addNewKind();
    },
    r: () => {
      for (const entry of pickRandom(gridMeshes(), KEY_BATCH)) {
        shown.splice(shown.indexOf(entry), 1);
        freeSlots.push(entry.slot);
        entry.mesh.destroy();
      }
    },
    h: () => {
      const grid = gridMeshes();

      for (const { mesh } of pickRandom(grid, Math.ceil(grid.length / 10))) mesh.visible = !mesh.visible;
    },
    m: () => {
      for (const { mesh } of pickRandom(gridMeshes(), KEY_BATCH)) {
        const others = materials.filter((material) => material !== mesh.material);

        mesh.material = others[Math.floor(Math.random() * others.length)];
      }
    },
    t: () => {
      for (const material of materials) {
        material.baseColor = new Color({ h: Math.random() * 360, s: 80, l: 55 }).toNumber();
      }
    },
  };

  const legend = new Text({ style: { fontFamily: 'monospace', fontSize: 14, fill: 0xffffff, lineHeight: 20 } });
  legend.position.set(12, 12);
  app.stage.addChild(legend);

  let lastKey = 'none';
  let worstMs = 0;
  let windowMs = 0;
  let windowFrames = 0;

  app.ticker.add((ticker) => {
    worstMs = Math.max(worstMs, ticker.elapsedMS);
    windowMs += ticker.elapsedMS;
    windowFrames++;
    if (windowMs < LEGEND_REFRESH_MS) return;

    legend.text = [
      `PR #706 on ${app.renderer.name}`,
      'Click the scene, then:',
      'A  add 10, kinds drawn',
      'N  add 1 new kind',
      `B  burst, ${BURST} new kinds`,
      'R  remove 10',
      'H  flip visible on 10 %',
      'M  swap material on 10',
      'T  change every baseColor',
      '',
      `meshes ${shown.length}, last key ${lastKey}`,
      `frame ${(windowMs / windowFrames).toFixed(1)} ms`,
      `worst ${worstMs.toFixed(1)} ms`,
    ].join('\n');
    windowMs = 0;
    windowFrames = 0;
  });

  window.addEventListener('keydown', (event) => {
    const action = actions[event.key.toLowerCase()];
    if (!action || event.repeat) return;

    action();
    lastKey = event.key.toUpperCase();
    worstMs = 0;
  });
}
