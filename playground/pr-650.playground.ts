import { Container3D, CubeGeometry, FlatMaterial, Mesh3D, View3D } from '@pixi/3d';
import { Application, CanvasSource, Text, Texture, TextureStyle, UPDATE_PRIORITY } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

const GRID = 16;
const SPACING = 1.2;
const A_COLORS: [string, string] = ['#f2c14e', '#3a3a8c'];
const B_COLORS: [string, string] = ['#6ec7c4', '#c0392b'];

function drawChecker(canvas: HTMLCanvasElement, cells: number, colors: [string, string]): void {
  canvas.width = canvas.height = cells;
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = colors[(x + y) % 2];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * PR #650: draw lists watch textures, material bind groups watch nothing.
 *
 * 256 cubes, each with its own FlatMaterial, share one checker texture A. Every key changes A or
 * the grid, and the change must show on the next frame on both backends with no console or WebGPU
 * errors. The HUD lists the keys and A's listener counts, which should stay at about one per draw
 * list however many materials use A.
 *
 * The round trip: press 5 to remove the grid, press 3 or 4, then 5 again. The cubes must come
 * back with A's current filtering.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x1d1d22 });
  document.body.appendChild(app.canvas);

  // Nearest filtering on a 2x2 texture shows crisp squares; linear blurs them, so a style change is easy to see.
  const canvasA = document.createElement('canvas');
  drawChecker(canvasA, 2, A_COLORS);
  const textureA = new Texture({ source: new CanvasSource({ resource: canvasA, scaleMode: 'nearest' }) });

  const canvasB = document.createElement('canvas');
  drawChecker(canvasB, 2, B_COLORS);
  const textureB = new Texture({ source: new CanvasSource({ resource: canvasB, scaleMode: 'nearest' }) });

  const NEAREST = new TextureStyle({ scaleMode: 'nearest' });
  const LINEAR = new TextureStyle({ scaleMode: 'linear' });
  const styleNames = new Map([
    [NEAREST, 'shared NEAREST'],
    [LINEAR, 'shared LINEAR'],
  ]);

  const view3d = new View3D({ autoResize: true });
  app.stage.addChild(view3d);
  view3d.camera.position.set(0, 0, 22);

  const geometry = new CubeGeometry();
  const grid = new Container3D();
  grid.rotation.set(0.2, -0.3, 0);
  view3d.root.addChild(grid);

  // Always drawn and never textured with A, so the draw list still has a member after the grid is removed.
  // A's command stays, empty, and A keeps its listeners until the list next rebuilds.
  const keeper = new Mesh3D({ geometry, material: new FlatMaterial({ baseColor: 0xffffff }) });
  keeper.scale.set(0.4, 0.4, 0.4);
  keeper.position.set(0, -11, 0);
  view3d.root.addChild(keeper);

  const meshes: Mesh3D[] = [];
  let swapped = false;

  function buildGrid(): void {
    meshes.length = 0;
    for (let i = 0; i < GRID * GRID; i++) {
      const x = i % GRID;
      const y = Math.floor(i / GRID);
      const texture = swapped && x < GRID / 2 ? textureB : textureA;
      const mesh = new Mesh3D({ geometry, material: new FlatMaterial({ baseColorTexture: texture }) });

      mesh.position.set((x - (GRID - 1) / 2) * SPACING, (y - (GRID - 1) / 2) * SPACING, 0);
      grid.addChild(mesh);
      meshes.push(mesh);
    }
  }

  buildGrid();

  const actions: Record<string, () => string> = {
    '1': () => {
      swapped = !swapped;
      for (const [i, mesh] of meshes.entries()) {
        if (i % GRID < GRID / 2) mesh.material.textures.baseColor = swapped ? textureB : textureA;
      }

      return `left half -> ${swapped ? 'B' : 'A'}`;
    },
    '2': () => {
      const cells = textureA.source.pixelWidth === 2 ? 4 : 2;

      // drawChecker sizes the canvas first, so resize() finds it already at size and doesn't clear it.
      drawChecker(canvasA, cells, A_COLORS);
      textureA.source.resize(cells, cells);

      return `A.source.resize(${cells}, ${cells})`;
    },
    '3': () => {
      const style = textureA.source.style;

      style.scaleMode = style.scaleMode === 'nearest' ? 'linear' : 'nearest';
      style.update();

      return `A.source.style.scaleMode = '${style.scaleMode}'; update()`;
    },
    '4': () => {
      const next = textureA.source.style === LINEAR ? NEAREST : LINEAR;

      textureA.source.style = next;

      return `A.source.style = ${styleNames.get(next)}`;
    },
    '5': () => {
      if (grid.parent) {
        grid.removeFromParent();

        return 'grid removed';
      }
      view3d.root.addChild(grid);

      return 'grid re-added';
    },
    '6': () => {
      const start = performance.now();
      const count = meshes.length;

      for (const mesh of meshes) mesh.destroy({ material: true });
      const destroyMs = performance.now() - start;
      buildGrid();

      return `destroyed ${count} meshes + materials (${destroyMs.toFixed(2)} ms), rebuilt`;
    },
  };

  let gpuErrors = 0;

  if (app.renderer.name === 'webgpu') {
    (app.renderer as WebGPURenderer).gpu.device.addEventListener('uncapturederror', () => gpuErrors++);
  }

  const hud = new Text({ style: { fontFamily: 'monospace', fontSize: 14, fill: 0xffffff, lineHeight: 20 } });
  hud.position.set(12, 12);
  app.stage.addChild(hud);

  let lastAction = 'none';
  let actionMs = 0;
  let frameMs = 0;
  let frameStart = 0;

  window.addEventListener('keydown', (event) => {
    const action = actions[event.key];
    if (!action || event.repeat) return;

    const start = performance.now();
    lastAction = action();
    actionMs = performance.now() - start;

    // Runs after the next render, so it times the frame that rebuilds the draw list.
    app.ticker.addOnce(
      () => {
        frameMs = performance.now() - frameStart;
      },
      null,
      UPDATE_PRIORITY.UTILITY,
    );
  });

  app.ticker.add(
    () => {
      frameStart = performance.now();

      const source = textureA.source;
      const style = source.style;

      hud.text = [
        `PR #650 on ${app.renderer.name}. Click the scene, then press a key.`,
        '1 swap left half A <-> B   2 resize A 2x2 <-> 4x4   3 A style.scaleMode + update()',
        '4 A.source.style = NEAREST / LINEAR   5 remove / re-add grid   6 destroy + rebuild grid',
        `grid: ${grid.parent ? 'shown' : 'removed'}, left half on ${swapped ? 'B' : 'A'}, ` +
          `A ${source.pixelWidth}x${source.pixelHeight}, A style ${style.scaleMode} (${styleNames.get(style) ?? 'own'})`,
        `last: ${lastAction} in ${actionMs.toFixed(2)} ms, next frame ${frameMs.toFixed(2)} ms`,
        `A listeners: change ${source.listenerCount('change')}, styleChange ${source.listenerCount('styleChange')}` +
          ' (about one per draw list, not one per material; WebGL adds a styleChange for its texture system)',
        app.renderer.name === 'webgpu' ? `WebGPU errors: ${gpuErrors}` : 'WebGL: watch the console for errors',
      ].join('\n');
    },
    null,
    UPDATE_PRIORITY.HIGH,
  );
}
