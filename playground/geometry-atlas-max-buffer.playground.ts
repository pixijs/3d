import { FlatMaterial, Geometry3D, Mesh3D, View3D } from '@pixi/3d';
import { Application, Text } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/** Positions, normals and uvs: 32 bytes a vertex, all one attribute layout and so one atlas */
const VERTICES_PER_MESH = 1 << 20;
/**
 * 9 Mi vertices is 288 MiB, past WebGPU's default `maxBufferSize` of 256 MiB: an atlas that doubles to fit them asks
 * for a 512 MiB vertex buffer, which is invalid, and every pass drawing from it fails, the 2D label's included
 */
const MESHES = 9;

function cloud(seed: number): Geometry3D {
  const positions = new Float32Array(VERTICES_PER_MESH * 3);
  const normals = new Float32Array(VERTICES_PER_MESH * 3);
  const uvs = new Float32Array(VERTICES_PER_MESH * 2);
  const indices = new Uint32Array(VERTICES_PER_MESH);

  for (let i = 0; i < VERTICES_PER_MESH; i++) {
    const t = (i + seed * VERTICES_PER_MESH) * 0.618034;
    positions[i * 3] = (t % 1) - 0.5;
    positions[i * 3 + 1] = ((t * 7.31) % 1) - 0.5;
    positions[i * 3 + 2] = ((t * 3.17) % 1) * 0.1;
    normals[i * 3 + 2] = 1;
    indices[i] = i;
  }

  return new Geometry3D({ positions, normals, uvs, indices });
}

export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, background: 0x223344 });
  document.body.appendChild(app.canvas);

  const view3d = new View3D({ autoResize: true });

  app.stage.addChild(view3d);
  view3d.camera.position.set(0, 0, 2);

  const material = new FlatMaterial({ baseColor: 0xffcc66 });

  for (let i = 0; i < MESHES; i++) {
    view3d.root.addChild(new Mesh3D({ geometry: cloud(i), material }));
  }

  const label = new Text({
    text: `${MESHES} meshes x ${VERTICES_PER_MESH} vertices: if you can read this, the atlas stayed in the limit`,
    style: { fill: 0xffffff, fontSize: 18 },
  });

  label.position.set(12, 12);
  app.stage.addChild(label);
}
