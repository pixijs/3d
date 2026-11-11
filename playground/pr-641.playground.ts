import type { BaseMaterial3D } from '@pixi/3d';
import {
  AmbientLight,
  CubeGeometry,
  DirectionalLight,
  FlatMaterial,
  Material3D,
  Mesh3D,
  PhongMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  View3D,
} from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import type { Texture } from 'pixi.js';
import { Application, Assets, Color } from 'pixi.js';

import { texture } from '../examples/assets/manifest';
import { rendererPreference } from './src/getPreference';

/**
 * PR #641: on WebGL every run in a material pass draws merged, each instance reading its own
 * material row from the store's texture. Open with `?renderer=webgl` and `?renderer=webgpu`; both
 * should look the same. Every mesh below has its own material, so a run that read the wrong row
 * would show one colour repeated across it.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x1d1d22 });
  document.body.appendChild(app.canvas);

  const [bunny, backdrop] = await Promise.all([
    Assets.load<Texture>(texture('pixijs.Bunny')),
    Assets.load<Texture>(texture('pixijs.SceneRotate')),
  ]);

  const view3d = new View3D({ autoResize: true, shadowQuality: 'high' });

  app.stage.addChild(view3d);

  const sun = new DirectionalLight({ intensity: 3, castShadow: true });

  sun.position.set(4, 8, 5);
  sun.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(sun, new AmbientLight({ intensity: 0.4 }));

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 16, height: 12 }),
    material: new Material3D({ baseColor: 0x3a3a44, roughness: 0.9 }),
    castShadow: false,
  });

  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  view3d.root.addChild(ground);

  const add = (mesh: Mesh3D, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    view3d.root.addChild(mesh);

    return mesh;
  };
  const color = new Color();
  const hue = (h: number, l = 55) => color.setValue({ h: ((h % 360) + 360) % 360, s: 75, l }).toNumber();

  // A: 64 spheres on one geometry with no textures, one material each. One opaque run, animated.
  const sphere = new SphereGeometry({ radius: 0.2, widthSegments: 24, heightSegments: 16 });
  const field: Mesh3D[] = [];
  const fieldMaterials: Material3D[] = [];

  for (let i = 0; i < 64; i++) {
    const material = new Material3D({
      baseColor: hue(i * (360 / 64)),
      roughness: 0.2 + 0.8 * ((i % 8) / 7),
      metallic: Math.floor(i / 8) % 2,
    });

    fieldMaterials.push(material);
    field.push(add(new Mesh3D({ geometry: sphere, material }), -6 + (i % 8) * 0.5, 0, -3 + Math.floor(i / 8) * 0.5));
  }

  // B: cubes on two texture sets, tinted per material. Each set is its own run; the tints must differ.
  const cube = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4 });

  for (let i = 0; i < 24; i++) {
    const map = i % 3 === 2 ? backdrop : bunny;
    const material = new Material3D({ baseColorTexture: map, baseColor: hue(i * 47, 70), roughness: 0.6 });

    add(new Mesh3D({ geometry: cube, material }), -1.5 + (i % 6) * 0.55, 0, -3 + Math.floor(i / 6) * 0.55);
  }

  // C: other shader families and an emissive group, each with its own colours.
  const torus = new TorusGeometry({ radius: 0.18, tube: 0.07 });

  for (let i = 0; i < 8; i++) {
    const x = 2.5 + i * 0.5;

    add(
      new Mesh3D({ geometry: sphere, material: new PhongMaterial({ baseColor: hue(i * 45), shininess: 64 }) }),
      x,
      0,
      -3,
    );
    add(new Mesh3D({ geometry: cube, material: new FlatMaterial({ baseColor: hue(i * 45 + 20) }) }), x, 0, -2.4);
    add(
      new Mesh3D({
        geometry: torus,
        material: new Material3D({ baseColor: 0x222222, emissive: { color: hue(i * 45 + 180), strength: 2 } }),
      }),
      x,
      0,
      -1.8,
    );
  }

  // D: masked, double-sided planes, turning so their back faces show.
  const leaf = new PlaneGeometry({ width: 0.5, height: 0.5 });
  const masked: Mesh3D[] = [];

  for (let i = 0; i < 8; i++) {
    const material = new Material3D({
      baseColorTexture: bunny,
      baseColor: hue(i * 45 + 90, 65),
      alphaMode: 'mask',
      alphaCutoff: 0.5,
      doubleSided: true,
    });

    masked.push(add(new Mesh3D({ geometry: leaf, material }), 2.5 + i * 0.5, 0, -1));
  }

  // E: blended meshes in depth-interleaved rows. The depth sort puts a different material, and on
  // some draws a different texture set, next to each other, and reorders them as the camera turns.
  const blended: Mesh3D[] = [];
  const blendedMaterials: Material3D[] = [];

  for (let i = 0; i < 36; i++) {
    const textured = i % 5 === 4;
    const material = new Material3D({
      baseColor: hue(i * 31, 60),
      baseColorTexture: textured ? bunny : undefined,
      alphaMode: 'blend',
      alpha: 0.35 + 0.4 * ((i % 4) / 3),
      roughness: 0.4,
    });
    const row = Math.floor(i / 6);
    const mesh = add(
      new Mesh3D({ geometry: i % 2 ? cube : sphere, material, castShadow: false }),
      -3 + (i % 6) * 0.45 + (row % 2) * 0.22,
      0.1 * (row % 3),
      0.5 + row * 0.35,
    );

    blended.push(mesh);
    blendedMaterials.push(material);
  }

  view3d.camera.position.set(0, 4, 6);

  const orbit = new OrbitCamera({ view: view3d, autoRotate: true, autoRotateSpeed: 0.5, enableDamping: true });

  orbit.target.set(0, 0, -1);

  const panel = document.createElement('pre');

  panel.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:8px 10px;font:12px/1.4 monospace;color:#ddd;background:#000a;pointer-events:none';
  panel.textContent = [
    `PR #641, ${rendererPreference}. Compare with the other ?renderer= value.`,
    'Back left: 64 spheres, each its own hue, cycling. A repeated colour means a run read the wrong row.',
    'Back middle: tinted cubes on two textures. Right: phong, flat, emissive torus, masked bunny planes.',
    'Front: blended spheres and cubes, each its own colour and alpha, sorted as the camera turns.',
    '',
    'space  pause animation        r  toggle auto-rotate',
    'b      field opaque <-> blend  h  hide every third blended mesh',
    's      swap neighbouring sphere materials',
  ].join('\n');
  document.body.appendChild(panel);

  let animate = true;
  let time = 0;

  window.addEventListener('keydown', (event) => {
    if (event.key === ' ') animate = !animate;
    if (event.key === 'r') orbit.autoRotate = !orbit.autoRotate;
    if (event.key === 'b') {
      const mode = fieldMaterials[0].alphaMode === 'blend' ? 'opaque' : 'blend';

      for (const material of fieldMaterials) {
        material.alphaMode = mode;
        material.alpha = mode === 'blend' ? 0.5 : 1;
      }
    }
    if (event.key === 'h') {
      for (let i = 1; i < blended.length; i += 3) blended[i].visible = !blended[i].visible;
    }
    if (event.key === 's') {
      for (let i = 0; i + 1 < field.length; i += 2) {
        const material: BaseMaterial3D = field[i].material;

        field[i].material = field[i + 1].material;
        field[i + 1].material = material;
      }
    }
  });

  app.ticker.add((ticker) => {
    if (!animate) return;
    time += ticker.deltaMS / 1000;

    for (let i = 0; i < fieldMaterials.length; i++) {
      fieldMaterials[i].baseColor = hue(i * (360 / 64) + time * 60);
    }
    for (let i = 0; i < blendedMaterials.length; i++) {
      blendedMaterials[i].alpha = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 2 + i));
    }
    for (const mesh of masked) mesh.rotation.y = time;
  });
}
