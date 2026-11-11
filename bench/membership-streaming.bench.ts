/**
 * Chunk streaming: 1,024 permanent meshes and three chunks of 256, 512 and 384 that enter and leave
 * on an eight-second loop. `pooled-shared` moves prebuilt chunks in and out; `allocated-shared`
 * creates and destroys the chunk's meshes; `allocated-fresh` also creates and destroys its
 * geometries, materials and textures. Event frames carry the cost, so read phase timings rather
 * than the window's median alone.
 */
import { Container3D, CubeGeometry, Material3D, Mesh3D } from '@pixi/3d';
import { frame } from 'benchy';

import { proceduralMaps } from './data/textures.ts';
import { toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** Unequal chunk arrivals and departures, separated by quiet frames and real resource lifetimes. */
frame('membership chunk streaming', {
  variants: {
    'pooled-shared': { resources: 'pooled-shared' },
    'allocated-shared': { resources: 'allocated-shared' },
    'allocated-fresh': { resources: 'allocated-fresh' },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 8,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { resources }: { resources: 'pooled-shared' | 'allocated-shared' | 'allocated-fresh' }) {
    const { view } = stage;
    view.camera.position.set(0, 24, 32);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });
    view.camera.fov = 50;
    view.camera.near = 0.1;
    view.camera.far = 150;
    // Pixel generation is setup work. Fresh variants still create/upload/destroy their engine resources.
    const maps = Array.from({ length: 4 }, (_, i) => proceduralMaps(910 + i, 64).albedo);
    const makeResources = () => {
      const textures = maps.map((map, i) => toTexture(map, `streaming-${i}`));
      const geometries = Array.from(
        { length: 8 },
        (_, i) => new CubeGeometry({ width: 0.3 + (i % 4) * 0.04, height: 0.4 + (i % 3) * 0.2, depth: 0.32 }),
      );
      const materials = Array.from(
        { length: 16 },
        (_, i) => new Material3D({ baseColorTexture: textures[i % 4], roughness: 0.5 + (i % 4) * 0.1 }),
      );
      return { textures, geometries, materials };
    };
    const releaseResources = (owned: ReturnType<typeof makeResources>): void => {
      for (const geometry of owned.geometries) geometry.destroy(true);
      for (const material of owned.materials) material.destroy();
      for (const texture of owned.textures) texture.destroy(true);
    };
    const shared = makeResources();
    const sizes = [256, 512, 384];
    const positions = sizes.map((size, chunk) => {
      const values = new Float32Array(size * 3);
      for (let i = 0; i < size; i++) {
        values[i * 3] = (chunk - 1) * 11 + ((i % 16) - 7.5) * 0.48;
        values[i * 3 + 1] = (0.4 + ((i % 8) % 3) * 0.2) / 2;
        values[i * 3 + 2] = 2 + Math.floor(i / 16) * 0.48;
      }
      return values;
    });
    const groups: (Container3D | null)[] = [null, null, null];
    const owned: (ReturnType<typeof makeResources> | null)[] = [null, null, null];
    const makeChunk = (chunk: number): Container3D => {
      const data = resources === 'allocated-fresh' ? (owned[chunk] = makeResources()) : shared;
      const group = new Container3D({ label: `streaming-chunk-${chunk}` });
      for (let i = 0; i < sizes[chunk]; i++) {
        const mesh = new Mesh3D({ geometry: data.geometries[i % 8], material: data.materials[Math.floor(i / 8) % 16] });
        mesh.position.fromArray(positions[chunk], i * 3);
        group.addChild(mesh);
      }
      groups[chunk] = group;
      return group;
    };
    for (let i = 0; i < 1024; i++) {
      const mesh = new Mesh3D({
        geometry: shared.geometries[i % 8],
        material: shared.materials[Math.floor(i / 8) % 16],
      });
      mesh.position.set(((i % 32) - 15.5) * 0.55, (0.4 + ((i % 8) % 3) * 0.2) / 2, -18 + Math.floor(i / 32) * 0.5);
      view.root.addChild(mesh);
    }
    if (resources === 'pooled-shared') for (let chunk = 0; chunk < sizes.length; chunk++) makeChunk(chunk);
    view.root.addChild(groups[0] ?? makeChunk(0));
    let active = 1;
    let wanted = 1;
    let leaving = 0;
    let entering = 0;
    let cameraX = 0;
    const aim = { x: 0, y: 0, z: 0 };
    return {
      simulate(seconds) {
        const frameIndex = Math.round(seconds * 60) % 480;
        wanted = 0;
        if (frameIndex < 120 || frameIndex >= 420) wanted |= 1;
        if (frameIndex >= 60 && frameIndex < 300) wanted |= 2;
        if (frameIndex >= 240 && frameIndex < 460) wanted |= 4;
        leaving = active & ~wanted;
        entering = wanted & ~active;
        cameraX = 7 * Math.sin((frameIndex / 480) * Math.PI * 2);
      },
      update() {
        for (let chunk = 0; chunk < sizes.length; chunk++) {
          if ((leaving & (1 << chunk)) === 0) continue;
          groups[chunk]!.removeFromParent();
          if (resources === 'pooled-shared') continue;
          groups[chunk]!.destroy({ children: true });
          groups[chunk] = null;
          const data = owned[chunk];
          if (data) releaseResources(data);
          owned[chunk] = null;
        }
        for (let chunk = 0; chunk < sizes.length; chunk++) {
          if (entering & (1 << chunk)) view.root.addChild(groups[chunk] ?? makeChunk(chunk));
        }
        active = wanted;
        view.camera.position.set(cameraX, 24, 32);
        view.camera.lookAt(aim);
      },
      destroy() {
        for (const group of groups) group?.destroy({ children: true });
        for (const data of owned) if (data) releaseResources(data);
        releaseResources(shared);
      },
    };
  },
});
