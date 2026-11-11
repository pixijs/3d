import { CubeGeometry, FlatMaterial, Mesh3D, PlaneGeometry, View3D } from '@pixi/3d';
import { Application, Text } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/**
 * PR #654: Camera3D.jitter moves the drawn image by a sub-pixel offset
 *
 * A white quad whose edges meet at the view's centre, and a row of thin tilted bars. Click to cycle
 * the modes, or press 1 to 4:
 *
 * 1. No jitter.
 * 2. A fixed `(1, 2)`: the quad's edges move exactly 1 physical pixel right and 2 down.
 * 3. A new Halton offset every frame, with nothing blending the frames: the image shakes, as the
 *    jitter's docs warn.
 * 4. The fixed `(1, 2)` again, in a composited view.
 *
 * The label shows two entries of the camera's own projection, which the jitter never changes.
 * Compare `renderer=webgpu` with `renderer=webgl`. The move is in physical pixels, so check it on a
 * HiDPI display, or reload after changing browser zoom.
 */

const MODES = ['no jitter', 'fixed (1, 2)', 'Halton every frame, unblended', 'fixed (1, 2), composited'];

/**
 * The `index`th entry of the Halton sequence in `base`, in [0, 1)
 * @param index - Position in the sequence, from 1.
 * @param base - The sequence's base: 2 for x, 3 for y.
 */
function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    result += fraction * (i % base);
    fraction /= base;
  }

  return result;
}

/**
 * A view of the test pattern, looking down -Z with an orthographic camera
 * @param composite - Whether the view draws into its own texture first.
 */
function buildView(composite: boolean): View3D {
  const view3d = new View3D({ autoResize: true, composite });
  view3d.camera.useOrthographic(10, 0.1, 100);
  view3d.camera.position.z = 10;

  const white = new FlatMaterial({ baseColor: 0xffffff, doubleSided: true });

  // Covers everything left of and above the centre, so two of its edges meet there
  const quad = new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: white });
  quad.position.set(-20, 20, 0);
  view3d.root.addChild(quad);

  const bar = new CubeGeometry({ width: 0.01, height: 3, depth: 0.01 });
  for (let i = 0; i < 12; i++) {
    const mesh = new Mesh3D({ geometry: bar, material: white });
    mesh.position.set(1 + i * 0.6, -2, 0);
    mesh.rotation.z = (i + 1) * 0.03;
    view3d.root.addChild(mesh);
  }

  return view3d;
}

export default async function () {
  const app = new Application();

  await app.init({
    resizeTo: window,
    preference: rendererPreference,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    backgroundColor: 0x000000,
  });
  document.body.appendChild(app.canvas);

  const direct = buildView(false);
  const composited = buildView(true);
  app.stage.addChild(direct, composited);

  // Sits on the white quad in every mode, so it needs a dark fill
  const label = new Text({ style: { fill: 0x0b3d91, fontSize: 14, fontFamily: 'monospace' } });
  label.position.set(12, 12);
  app.stage.addChild(label);

  let mode = 0;
  const setMode = (next: number) => {
    mode = next;
    direct.visible = mode !== 3;
    composited.visible = mode === 3;
    direct.camera.jitter.set(0, 0);
    composited.camera.jitter.set(0, 0);
    if (mode === 1) direct.camera.jitter.set(1, 2);
    if (mode === 3) composited.camera.jitter.set(1, 2);
  };
  setMode(0);

  app.canvas.addEventListener('pointerdown', () => setMode((mode + 1) % MODES.length));
  window.addEventListener('keydown', (event) => {
    const index = Number(event.key) - 1;
    if (index >= 0 && index < MODES.length) setMode(index);
  });

  let frame = 0;
  app.ticker.add(() => {
    frame++;
    if (mode === 2) direct.camera.jitter.set(halton((frame % 8) + 1, 2) - 0.5, halton((frame % 8) + 1, 3) - 0.5);

    const camera = mode === 3 ? composited.camera : direct.camera;
    const e = camera.projection.elements;
    const text =
      `${mode + 1}: ${MODES[mode]} (click or press 1-4)\n` +
      `jitter (${camera.jitter.x.toFixed(3)}, ${camera.jitter.y.toFixed(3)}) physical px\n` +
      `camera.projection [8] ${e[8].toFixed(4)}  [12] ${e[12].toFixed(4)}`;
    if (label.text !== text) label.text = text;
  });
}
