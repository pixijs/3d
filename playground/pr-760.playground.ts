import { Container3D, DirectionalLight, Material3D, Model3D, View3D } from '@pixi/3d';
import type { BaseMaterial3D, Scene3DSource } from '@pixi/3d';
import { Application, Assets, Point, Text } from 'pixi.js';
import type { CubeTexture } from 'pixi.js';

import { model } from '../examples/assets/manifest';
import { rendererPreference } from './src/getPreference';

const KNIGHT_HEIGHT = 2;
const KNIGHT_SPACING = 2.4;
const SPHERES_WIDTH = 4.4;
const SPHERES_Y = -2.6;
const SOURCE_COLOURS = [0x3fa7ff, 0x40d070, 0xffffff];
const COPY_COLOURS = [0xffa020, 0xa060ff, 0xffe040];
const SWORD_DROP_X = 0.9;

/**
 * PR #760: `Model3D` draws materials of its own, by label, index or function.
 *
 * Five knights from one source, playing `Run_Sword_Right` so the sword shows and the skin moves
 * (`Idle` scales the sword to 0). Left to right:
 *
 * 1. source: built plain, draws the source's materials.
 * 2. record: `{ Armor: red, Golden: blue }`.
 * 3. array: only the `Skin` index replaced, with green.
 * 4. function: `(m) => m.clone()`, copies of every material.
 * 5. assign then revert: built plain; `D` assigns and reverts.
 *
 * Under them, EnvironmentTest twice: plain, and with `{ DielectricSpheresMat: red }`. The file has
 * two different materials named `DielectricSpheresMat`, one per dielectric row.
 *
 * Each caption says `shared` while the model's `materials` is the source's list, `own` otherwise.
 *
 * - S: write `baseColor` on the source's `Armor` material
 * - C: write `baseColor` on column 4's `Armor` copy
 * - D: column 5 draws magenta `clone()` copies; again, back to the source's and the copies destroyed
 * - X: move column 5's sword out of the model into `view3d.root`, beside the knight; only while
 *   column 5 draws the source's materials
 *
 * What to look for:
 *
 * - Columns 2 and 3: only the named or indexed parts change colour. Column 2's red is the body
 *   armour alone, not the sword's grey; its blue is the helmet's gold trim alone.
 * - Every knight keeps running while materials change; none snaps to the bind pose.
 * - S recolours the armour on columns 1, 3 and 5 (blue, green, white), not 2 (replaced) or 4
 *   (copies).
 * - C recolours column 4 only (orange, purple, yellow).
 * - D on: column 5 is magenta on the next frame. D off: it draws as column 1 again, and nothing
 *   flickers or vanishes in the frames after (its copies are destroyed).
 * - X, then D: the knight turns magenta and the dropped sword keeps its look. D off: the knight
 *   draws as column 1 again and the sword still keeps its look.
 * - Bottom right: both dielectric rows are red, the metallic row isn't.
 * - No console errors or WebGPU validation warnings.
 *
 * Compare `renderer=webgpu` with `renderer=webgl`.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x191919 });
  document.body.appendChild(app.canvas);

  const [source, spheres, environment] = await Promise.all([
    Assets.load<Scene3DSource>(model('gltf.Knight')),
    Assets.load<Scene3DSource>(model('gltf.EnvironmentTest')),
    Assets.load<CubeTexture>('/venice-sunset/venice-sunset.cubemap'),
  ]);

  const view3d = new View3D({ autoResize: true, environment });
  app.stage.addChild(view3d);
  view3d.camera.fov = 45;
  view3d.camera.position.set(0, 0.2, 10.5);
  view3d.camera.lookAt({ x: 0, y: 0.2, z: 0 });

  const sun = new DirectionalLight({ intensity: 2 });
  sun.position.set(3, 6, 8);
  sun.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(sun);

  const indexOf = (label: string) => source.materials.findIndex((material) => material.label === label);
  const armorIndex = indexOf('Armor');
  const skinOnly: (BaseMaterial3D | undefined)[] = [];
  skinOnly[indexOf('Skin')] = new Material3D({ baseColor: 0x30c040, roughness: 0.5 });

  const columns: [string, Model3D][] = (
    [
      ['source', {}],
      [
        'record',
        {
          materials: {
            Armor: new Material3D({ baseColor: 0xd03030 }),
            Golden: new Material3D({ baseColor: 0x2060ff }),
          },
        },
      ],
      ['array', { materials: skinOnly }],
      ['function copies', { materials: (material: BaseMaterial3D) => material.clone() }],
      ['assign then revert', {}],
    ] as const
  ).map(([caption, options], i) => {
    const knight = new Model3D({ source, autoPlay: 'Run_Sword_Right', ...options });

    knight.scale.set(KNIGHT_HEIGHT / knight.getLocalBounds().height);
    knight.position.set((i - 2) * KNIGHT_SPACING, 0, 0);
    view3d.root.addChild(knight);

    return [caption, knight];
  });

  const [, copies] = columns[3];
  const [, toggled] = columns[4];

  const red = new Material3D({ baseColor: 0xd03030 });
  const sphereRows: [string, Model3D][] = (
    [
      ['plain', undefined],
      ['{ DielectricSpheresMat: red }', { DielectricSpheresMat: red }],
    ] as const
  ).map(([caption, materials], i) => {
    const row = new Model3D({ source: spheres, materials });

    row.scale.set(SPHERES_WIDTH / row.getLocalBounds().width);
    row.position.set((i - 0.5) * (SPHERES_WIDTH + 0.6), SPHERES_Y, 0);
    view3d.root.addChild(row);

    return [caption, row];
  });

  let sourcePresses = 0;
  let copyPresses = 0;
  let swordDropped = false;

  const actions: Record<string, () => void> = {
    s: () => {
      source.materials[armorIndex].baseColor = SOURCE_COLOURS[sourcePresses++ % SOURCE_COLOURS.length];
    },
    c: () => {
      copies.materials[armorIndex].baseColor = COPY_COLOURS[copyPresses++ % COPY_COLOURS.length];
    },
    d: () => {
      if (toggled.materials === source.materials) {
        toggled.materials = (material) => material.clone({ baseColor: 0xff00ff });

        return;
      }

      const own = [...toggled.materials];

      toggled.materials = undefined;
      own.forEach((material) => material.destroy());
    },
    x: () => {
      if (swordDropped || toggled.materials !== source.materials) return;

      let sword: Container3D | undefined;
      toggled.traverse((node) => {
        if (node.label === 'ShortSword') sword = node;
      });
      if (!sword?.parent) return;

      const dropped = new Container3D({ parent: sword.parent });

      view3d.root.reparentChild(dropped);
      dropped.position.x += SWORD_DROP_X;
      dropped.addChild(sword);
      swordDropped = true;
    },
  };

  const textStyle = { fontFamily: 'monospace', fontSize: 14, fill: 0xffffff, lineHeight: 20, align: 'center' } as const;
  const legend = new Text({ style: { ...textStyle, align: 'left' } });
  legend.anchor.set(1, 0);
  app.stage.addChild(legend);

  const captions = [...columns, ...sphereRows].map(([caption, owner], i) => {
    const text = new Text({ style: textStyle });

    text.anchor.set(0.5, 0);
    app.stage.addChild(text);

    return { caption: `${i < columns.length ? `${i + 1} ` : ''}${caption}`, owner, text };
  });

  let lastKey = 'none';
  const screen = new Point();

  app.ticker.add(() => {
    legend.text = [
      `PR #760 on ${app.renderer.name}, last key ${lastKey}`,
      "S  recolour the source's Armor",
      "C  recolour column 4's Armor copy",
      'D  column 5: magenta copies, or back',
      "X  drop column 5's sword (D off)",
    ].join('\n');
    legend.position.set(app.screen.width - 12, 12);

    for (const { caption, owner, text } of captions) {
      const point = view3d.worldToScreen(owner.getGlobalPosition(), screen);

      text.visible = point !== null;
      if (!point) continue;

      text.text = `${caption}\n${owner.materials === owner.source.materials ? 'shared' : 'own'}`;
      text.position.set(point.x, point.y + 8);
    }
  });

  window.addEventListener('keydown', (event) => {
    const action = actions[event.key.toLowerCase()];
    if (!action || event.repeat) return;

    action();
    lastKey = event.key.toUpperCase();
  });
}
