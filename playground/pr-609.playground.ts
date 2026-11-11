/**
 * PR #609: the CPU cull reads packed bounding spheres and visibility bytes from the mesh store.
 *
 * 2,000 spinning scene meshes and a 2,000-slot BatchedMesh3D, both spread well past the frustum
 * while the camera pans across them. Most shapes are long rods, so a sphere with the wrong radius
 * shows at the screen edges. Half the slots move through `setMatrixAt` and half through
 * `matrices.data` plus `matrices.update`. The batch sits in a container that drifts and turns.
 * A few blended spheres keep a back-to-front pass culling on the CPU under WebGPU's `'gpu'` mode.
 * A ground plane below the field takes the shadows.
 *
 * Keys: 1 / 2 / 3 set `cull` to off / cpu / gpu on the view and the batch. WebGL has no compute
 * pass, so its `'gpu'` mode culls on the CPU too: on WebGL, 2 and 3 take the same path. H hides or
 * shows every other mesh and slot. S swaps every seventh mesh and slot to a much larger geometry
 * and back. P pauses the meshes and slots, so the cull checks rows that stopped moving. C pauses
 * the camera. D turns the directional light's cascaded shadows on and off; they start off.
 *
 * What to look for:
 * - Nothing vanishes while any part of it is still on screen, at every edge.
 * - Hidden items stay hidden, and shown items come back.
 * - Swapped items stay correct at the edges. Also swap with P on, because while things move every
 *   frame rewrites their spheres anyway.
 * - With shadows on, no shadow pops or goes missing from a caster just off screen: the cascades
 *   cull through the same spheres.
 * - The picture matches across modes, and across `?renderer=webgl` and `?renderer=webgpu`.
 */

import {
  AmbientLight,
  BatchedMesh3D,
  Container3D,
  CubeGeometry,
  DirectionalLight,
  Material3D,
  Matrix4,
  Mesh3D,
  PlaneGeometry,
  RenderPassBit,
  SphereGeometry,
  View3D,
} from '@pixi/3d';
import type { CullMode } from '@pixi/3d';
import { Application, RendererType, Text } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

const MESH_COUNT = 2_000;
const SLOT_COUNT = 2_000;
const MATRIX_SLOTS = SLOT_COUNT / 2;
const SPREAD = { x: 110, y: 45, z: 70 };
const SWAP_EVERY = 7;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x15161c });
  document.body.appendChild(app.canvas);

  const view3d = new View3D({ autoResize: true, cull: 'cpu' });
  app.stage.addChild(view3d);

  const light = new DirectionalLight({
    color: 0xffffff,
    intensity: 6,
    castShadow: false,
    shadow: { cascades: 3, maxDistance: 150 },
  });
  light.rotation.set(-Math.PI / 3, Math.PI / 5, 0);
  view3d.root.addChild(light, new AmbientLight({ color: 0xffffff, intensity: 0.3 }));

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 320, height: 240 }),
    material: new Material3D({ baseColor: 0x8a8f99, roughness: 0.9 }),
    castShadow: false,
  });
  ground.rotation.set(-Math.PI / 2, 0, 0);
  ground.position.set(0, -SPREAD.y - 5, -20);
  view3d.root.addChild(ground);

  const small = new CubeGeometry({ width: 1, height: 1, depth: 1 });
  const large = new SphereGeometry({ radius: 2.5 });
  const palette = [0x4fa3ff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xc77dff].map(
    (baseColor) => new Material3D({ baseColor, metallic: 0.1, roughness: 0.5 }),
  );
  const rand = mulberry32(609);
  const randomIn = (extent: number) => (rand() - 0.5) * 2 * extent;

  const meshes: Mesh3D[] = [];
  const meshSpin = new Float32Array(MESH_COUNT * 3);
  for (let i = 0; i < MESH_COUNT; i++) {
    const mesh = new Mesh3D({ geometry: small, material: palette[i % palette.length] });
    mesh.position.set(randomIn(SPREAD.x), randomIn(SPREAD.y), randomIn(SPREAD.z) - 20);
    mesh.scale.set(4 + rand() * 4, 0.3 + rand() * 0.4, 0.3 + rand() * 0.4);
    mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    for (let k = 0; k < 3; k++) meshSpin[i * 3 + k] = (rand() - 0.5) * 2;
    view3d.root.addChild(mesh);
    meshes.push(mesh);
  }

  const glass = new Material3D({ baseColor: 0x9fd8ff, alphaMode: 'blend', alpha: 0.35 });
  for (let i = 0; i < 4; i++) {
    const sphere = new Mesh3D({ geometry: large, material: glass });
    sphere.position.set(i * 12 - 18, 0, 5);
    view3d.root.addChild(sphere);
  }

  const drift = new Container3D();
  view3d.root.addChild(drift);
  const batched = new BatchedMesh3D({ size: SLOT_COUNT, cull: 'cpu', parent: drift });
  const slotPosition = new Float32Array(SLOT_COUNT * 3);
  const slotScale = new Float32Array(SLOT_COUNT * 3);
  const slotAngle = new Float32Array(SLOT_COUNT * 3);
  const slotSpin = new Float32Array(SLOT_COUNT * 3);
  for (let i = 0; i < SLOT_COUNT; i++) {
    slotPosition[i * 3] = randomIn(SPREAD.x);
    slotPosition[i * 3 + 1] = randomIn(SPREAD.y);
    slotPosition[i * 3 + 2] = randomIn(SPREAD.z) - 20;
    slotScale[i * 3] = 0.3 + rand() * 0.4;
    slotScale[i * 3 + 1] = 4 + rand() * 4;
    slotScale[i * 3 + 2] = 0.3 + rand() * 0.4;
    for (let k = 0; k < 3; k++) {
      slotAngle[i * 3 + k] = rand() * Math.PI;
      slotSpin[i * 3 + k] = (rand() - 0.5) * 2;
    }
    batched.setGeometryAt(i, small);
    batched.setMaterialAt(i, palette[(i + 2) % palette.length]);
    batched.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
  }

  const slotMatrix = new Matrix4();
  const euler = { x: 0, y: 0, z: 0 };
  const scale = { x: 0, y: 0, z: 0 };
  const position = { x: 0, y: 0, z: 0 };
  const composeSlot = (i: number): Matrix4 => {
    const o = i * 3;
    euler.x = slotAngle[o];
    euler.y = slotAngle[o + 1];
    euler.z = slotAngle[o + 2];
    scale.x = slotScale[o];
    scale.y = slotScale[o + 1];
    scale.z = slotScale[o + 2];
    position.x = slotPosition[o];
    position.y = slotPosition[o + 1];
    position.z = slotPosition[o + 2];

    return slotMatrix.makeRotationFromEuler(euler).scale(scale).setPosition(position);
  };
  const writeSlots = (): void => {
    for (let i = 0; i < MATRIX_SLOTS; i++) batched.setMatrixAt(i, composeSlot(i));
    const { data, stride, offset } = batched.matrices;
    for (let i = MATRIX_SLOTS; i < SLOT_COUNT; i++) data.set(composeSlot(i).elements, offset + i * stride);
    batched.matrices.update(MATRIX_SLOTS, SLOT_COUNT - MATRIX_SLOTS);
  };
  writeSlots();

  let cull: CullMode = 'cpu';
  let hidden = false;
  let swapped = false;
  let objectsPaused = false;
  let cameraPaused = false;
  let cameraTime = 0;
  let objectTime = 0;

  const renderer = app.renderer.type === RendererType.WEBGPU ? 'webgpu' : 'webgl';
  const overlay = new Text({ style: { fontFamily: 'monospace', fontSize: 13, fill: 0xe6ecff, lineHeight: 18 } });
  overlay.position.set(12, 10);
  app.stage.addChild(overlay);
  const refreshOverlay = (): void => {
    overlay.text = [
      `PR #609, ${renderer}, cull '${cull}'`,
      `1/2/3 cull off/cpu/gpu   H hidden: ${hidden}   S swapped: ${swapped}`,
      `P objects paused: ${objectsPaused}   C camera paused: ${cameraPaused}   D shadows: ${light.castShadow}`,
      "On WebGL, 'gpu' culls on the CPU too, so 2 and 3 take the same path.",
      'Nothing should vanish while still on screen.',
    ].join('\n');
  };
  refreshOverlay();

  const modes: Record<string, CullMode> = { '1': 'off', '2': 'cpu', '3': 'gpu' };
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const mode = modes[key];
    if (mode) {
      cull = mode;
      view3d.cull = mode;
      batched.cull = mode;
    } else if (key === 'h') {
      hidden = !hidden;
      for (let i = 0; i < MESH_COUNT; i += 2) meshes[i].visible = !hidden;
      for (let i = 0; i < SLOT_COUNT; i += 2) batched.setVisibleAt(i, !hidden);
    } else if (key === 's') {
      swapped = !swapped;
      const geometry = swapped ? large : small;
      for (let i = 0; i < MESH_COUNT; i += SWAP_EVERY) meshes[i].geometry = geometry;
      for (let i = 0; i < SLOT_COUNT; i += SWAP_EVERY) batched.setGeometryAt(i, geometry);
    } else if (key === 'p') {
      objectsPaused = !objectsPaused;
    } else if (key === 'c') {
      cameraPaused = !cameraPaused;
    } else if (key === 'd') {
      light.castShadow = !light.castShadow;
    } else {
      return;
    }
    refreshOverlay();
  });

  const camera = view3d.camera;
  const target = { x: 0, y: 0, z: -20 };
  camera.position.set(0, 6, 45);
  camera.lookAt(target);

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;

    if (!cameraPaused) {
      cameraTime += dt;
      target.x = Math.sin(cameraTime * 0.3) * 40;
      target.y = Math.sin(cameraTime * 0.17) * 12;
      camera.lookAt(target);
    }
    if (objectsPaused) return;

    objectTime += dt;
    for (let i = 0; i < MESH_COUNT; i++) {
      const rotation = meshes[i].rotation;
      rotation.x += meshSpin[i * 3] * dt;
      rotation.y += meshSpin[i * 3 + 1] * dt;
      rotation.z += meshSpin[i * 3 + 2] * dt;
    }
    for (let i = 0; i < SLOT_COUNT * 3; i++) slotAngle[i] += slotSpin[i] * dt;
    writeSlots();
    drift.position.x = Math.sin(objectTime * 0.25) * 10;
    drift.rotation.y = objectTime * 0.05;
  });
}
