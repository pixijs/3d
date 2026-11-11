/**
 * `churn`: a living population. 6000 meshes over 500 geometries and 32 textured materials, 5000 of them in the scene
 * at any moment. The transforms stand still, so what a frame pays beyond the static field is the batch keeping its
 * draw list in step with the change.
 *
 * Judged on `cpu.render`: the sort, the batcher's walk and the bundle recording all happen inside the render, while
 * the add and remove calls are the update's.
 *
 * `static` churns nothing: the same 5000 meshes every frame, the floor the other variants are read against.
 *
 * `n10` and `n100` move a window: every frame N leave the scene and N others join it, with `removeChild` and
 * `addChild`, and nothing is created or destroyed. Who is out is a function of the frame alone: a window of 1000
 * places in a shuffled order of the objects, moved N places a frame. So every arm churns the same objects on the
 * same frame, and a pass that starts over moves the window back once.
 *
 * The other modes keep the same 5000 in the scene and churn exactly N of them a frame, taken in turn from a
 * shuffled order of that population, starting again from the top on every pass. `bounce1` and `bounce10` take the N
 * meshes out of the scene and straight back in, so the scene's content never changes: the smallest churn a scene
 * can see, and the one a draw list can absorb without rebuilding. `replace1` and `replace10` remove and destroy the
 * N meshes, and new meshes with the same geometry, material and transform take their place, so what recurs is the
 * kind of mesh, never the mesh. In `replace-destroy10` every mesh owns its material and maps from the start
 * (16 texels a side, so 6000 pairs stay small), and each replacement builds a fresh pair and destroys the old mesh's
 * with it: every arrival is a kind the list has never drawn, and every departure destroys what its command bound.
 * `spawn1` and `spawn10` replace as `replace` does, but each new mesh gets a material of its own, built from its
 * object's spec and sharing that spec's maps, and the mesh it replaces destroys its own material, never the maps: a
 * pool that gives every spawn its own material, to tint or flash it. Every arrival is a kind the list has never
 * drawn, while the textures every command binds live on, so nothing but the new kinds asks the list to rebuild.
 * `blink10` and `shadow-blink10` leave the 5000 alone and blink two pools of N meshes in the free places of the
 * objects out of the scene: after a first frame with neither, every frame one pool leaves and the other joins. Each blinker has a material and maps of
 * its own, never destroyed, so every join is a kind no built command draws and every departure is a mesh that
 * joined that way: the only change a frame makes is to the members a list draws apart from its built commands.
 * `bounce10-tail` is `bounce10` with one mesh of a kind no list draws standing in the scene from a pass's second
 * frame on: the known-kind churn of `bounce10` over a list that keeps a tail.
 * `reskin10` moves no mesh in or out: N meshes a frame swap to the next of the 32 materials, a kind the scene may or
 * may not draw already, and a pass that starts over puts every mesh back on its first material.
 *
 * The `shadow-` variants cast: every mesh casts and receives, and the sun casts two cascades, the far one redrawn
 * every fourth frame, so a cascade can miss frames of churn and catch up. They cull `'off'` and `'cpu'`, which
 * compact in a fixed order; the GPU cull's order varies between runs and its frames would not compare. The far
 * cascade's cadence counts the renderer's frames, not scene time: a pass that starts over redraws both cascades,
 * but where the far one's fourth frame falls can differ between runs, which a measurement window averages out.
 */

import { Material3D, Mesh3D } from '@pixi/3d';
import type { CullMode } from '@pixi/3d';
import { frame } from 'benchy';

import { churnScene } from './data/field.ts';
import type { PbrSpec } from './data/look.ts';
import { rng } from './data/rng.ts';
import { proceduralMaps } from './data/textures.ts';
import { applyLook, displayColor, toGeometry, toMaterial, toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** Objects out of the scene at any moment. */
const OUT = 1000;

/** Edge of the maps each `replace-destroy` material owns, in texels. */
const OWN_MAP_SIZE = 16;

/** A `replace-destroy` material: `spec` with a map pair of its own at {@link OWN_MAP_SIZE}, released by `destroy(true)` */
function ownMaterialOf(spec: PbrSpec): Material3D {
  const maps = proceduralMaps(spec.texture ?? 0, OWN_MAP_SIZE);
  return new Material3D({
    baseColor: displayColor(spec.color),
    roughness: spec.roughness,
    metallic: spec.metalness,
    baseColorTexture: toTexture(maps.albedo, 'own-albedo'),
    normalTexture: toTexture(maps.normal, 'own-normal'),
  });
}

/** A `spawn` material: `spec` again, drawing `shared`'s maps, so it binds the textures the scene already draws */
function spawnMaterialOf(spec: PbrSpec, shared: Material3D): Material3D {
  return new Material3D({
    baseColor: displayColor(spec.color),
    roughness: spec.roughness,
    metallic: spec.metalness,
    baseColorTexture: shared.textures.baseColor,
    normalTexture: shared.textures.normal,
  });
}

frame('churn', {
  variants: {
    n10: { births: 10, mode: 'window', shadows: false, cull: 'gpu', standing: 0 },
    n100: { births: 100, mode: 'window', shadows: false, cull: 'gpu', standing: 0 },
    static: { births: 0, mode: 'window', shadows: false, cull: 'gpu', standing: 0 },
    bounce1: { births: 1, mode: 'bounce', shadows: false, cull: 'gpu', standing: 0 },
    bounce10: { births: 10, mode: 'bounce', shadows: false, cull: 'gpu', standing: 0 },
    replace1: { births: 1, mode: 'replace', shadows: false, cull: 'gpu', standing: 0 },
    replace10: { births: 10, mode: 'replace', shadows: false, cull: 'gpu', standing: 0 },
    'replace-destroy10': { births: 10, mode: 'replace-destroy', shadows: false, cull: 'gpu', standing: 0 },
    spawn1: { births: 1, mode: 'spawn', shadows: false, cull: 'gpu', standing: 0 },
    spawn10: { births: 10, mode: 'spawn', shadows: false, cull: 'gpu', standing: 0 },
    reskin10: { births: 10, mode: 'reskin', shadows: false, cull: 'gpu', standing: 0 },
    'shadow-n10': { births: 10, mode: 'window', shadows: true, cull: 'off', standing: 0 },
    'shadow-bounce10': { births: 10, mode: 'bounce', shadows: true, cull: 'off', standing: 0 },
    'shadow-bounce10-cpu': { births: 10, mode: 'bounce', shadows: true, cull: 'cpu', standing: 0 },
    'shadow-spawn10': { births: 10, mode: 'spawn', shadows: true, cull: 'off', standing: 0 },
    blink10: { births: 10, mode: 'blink', shadows: false, cull: 'gpu', standing: 0 },
    'shadow-blink10': { births: 10, mode: 'blink', shadows: true, cull: 'off', standing: 0 },
    'bounce10-tail': { births: 10, mode: 'bounce', shadows: false, cull: 'gpu', standing: 1 },
  },
  primary: 'cpu.render',
  gate: 'strict',
  create(
    stage: PixiStage,
    {
      births,
      mode,
      shadows,
      cull,
      standing,
    }: {
      births: number;
      mode: 'window' | 'bounce' | 'replace' | 'replace-destroy' | 'spawn' | 'blink' | 'reskin';
      shadows: boolean;
      cull: CullMode;
      standing: number;
    },
  ) {
    const data = churnScene();
    applyLook(stage, data.look);
    const { view } = stage;
    view.cull = cull;
    if (shadows) {
      const { sun } = stage.lights;
      sun.castShadow = true;
      sun.shadow.cascades = 2;
      sun.shadow.update = [1, 4];
    }
    const ownMaps = mode === 'replace-destroy';
    const geometries = data.geometries.map(toGeometry);
    const materials = ownMaps ? [] : data.materials.map(toMaterial);
    const count = data.count;
    /** `replace-destroy`: each object's own material, destroyed with the mesh that draws it */
    const ownMaterial: (Material3D | null)[] = Array.from({ length: count }, () => null);
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const spec = data.materials[data.material[i] ?? 0];
      const material = ownMaps && spec ? ownMaterialOf(spec) : materials[data.material[i] ?? 0];
      if (!geometry || !material) throw new Error(`churn: object ${i} names a geometry or material that is not there`);
      if (ownMaps) ownMaterial[i] = material;
      const mesh = new Mesh3D({ geometry, material, castShadow: shadows, receiveShadow: shadows });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      meshes.push(mesh);
    }

    const place = new Int32Array(count);
    const shuffle = rng(2800);
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = shuffle.int(i + 1);
      const swap = order[i] ?? 0;
      order[i] = order[j] ?? 0;
      order[j] = swap;
    }
    order.forEach((object, at) => (place[object] = at));

    const isOut = (object: number, frameIndex: number): boolean =>
      ((((place[object] ?? 0) - frameIndex * births) % count) + count) % count < OUT;
    const inScene = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (isOut(i, 0)) continue;
      view.root.addChild(meshes[i] as Mesh3D);
      inScene[i] = 1;
    }

    /** The other modes' churn order: the population in the scene, shuffled */
    const live = order.filter((object) => inScene[object]);
    /** A mesh of object `object`'s geometry and place, drawing a material and maps of its own: a kind no list draws */
    const ownMeshAt = (object: number): Mesh3D => {
      const spec = data.materials[data.material[object] ?? 0];
      const geometry = geometries[data.geom[object] ?? 0];
      if (!spec || !geometry) throw new Error(`churn: object ${object} names a geometry or material that is not there`);
      const mesh = new Mesh3D({ geometry, material: ownMaterialOf(spec), castShadow: shadows, receiveShadow: shadows });
      mesh.position.fromArray(data.position, object * 3);
      mesh.scale.set(data.scale[object] ?? 1);
      mesh.quaternion.fromArray(data.quat, object * 4);
      return mesh;
    };
    /** The places of the objects out of the scene, free for meshes the modes add */
    const freePlaces = order.filter((object) => !inScene[object]);
    /** `blink`: two pools of `births` meshes in free places, each with maps of its own */
    const blinkers = mode === 'blink' ? freePlaces.slice(0, births * 2).map(ownMeshAt) : [];
    /** `standing`: meshes of kinds no list draws, in the scene from a pass's second frame on, so they stand in a tail */
    const standers = freePlaces.slice(births * 2, births * 2 + standing).map(ownMeshAt);
    let standersShown = false;
    /** Each added mesh's material, kept apart from its mesh, which a scene teardown may destroy first */
    const blinkMaterials = [...blinkers, ...standers].map((mesh) => mesh.material);
    /**
     * `blink`: the pool in the scene, or -1 for none. A pass's first frame shows neither, so the lists are built
     * without them and every pool that joins later is a kind no built command draws
     */
    let blinkPool = -1;
    /** `reskin`: each mesh's current material */
    const meshMaterial = Uint8Array.from(data.material);

    let frameIndex = 0;
    let lastFrame = 0;
    return {
      simulate(seconds) {
        frameIndex = Math.round(seconds * 60);
      },
      update() {
        const rewound = frameIndex < lastFrame;
        if (rewound && shadows) stage.lights.sun.refreshShadows();
        if (standers.length > 0 && standersShown !== frameIndex > 0) {
          standersShown = frameIndex > 0;
          for (const mesh of standers) {
            if (standersShown) view.root.addChild(mesh);
            else view.root.removeChild(mesh);
          }
        }
        if (mode === 'window') {
          for (let i = 0; i < count; i++) {
            const wanted = isOut(i, frameIndex) ? 0 : 1;
            if (inScene[i] === wanted) continue;
            const mesh = meshes[i] as Mesh3D;
            if (wanted) view.root.addChild(mesh);
            else view.root.removeChild(mesh);
            inScene[i] = wanted;
          }
          lastFrame = frameIndex;
          return;
        }
        if (mode === 'blink') {
          const pool = frameIndex === 0 ? -1 : frameIndex & 1;
          if (pool !== blinkPool) {
            for (let k = 0; k < births; k++) {
              if (blinkPool >= 0) view.root.removeChild(blinkers[blinkPool * births + k] as Mesh3D);
              if (pool >= 0) view.root.addChild(blinkers[pool * births + k] as Mesh3D);
            }
            blinkPool = pool;
          }
          lastFrame = frameIndex;
          return;
        }
        const churned = rewound ? 0 : Math.min((frameIndex - lastFrame) * births, live.length);
        if (mode === 'reskin') {
          if (rewound) {
            for (const i of live) {
              const first = data.material[i] ?? 0;
              if (meshMaterial[i] === first) continue;
              (meshes[i] as Mesh3D).material = materials[first] as Material3D;
              meshMaterial[i] = first;
            }
          }
          for (let k = 0; k < churned; k++) {
            const i = live[(lastFrame * births + k) % live.length] ?? 0;
            const next = ((meshMaterial[i] ?? 0) + 1) % materials.length;
            (meshes[i] as Mesh3D).material = materials[next] as Material3D;
            meshMaterial[i] = next;
          }
          lastFrame = frameIndex;
          return;
        }
        for (let k = 0; k < churned; k++) {
          const i = live[(lastFrame * births + k) % live.length] ?? 0;
          const mesh = meshes[i] as Mesh3D;
          view.root.removeChild(mesh);
          if (mode === 'bounce') {
            view.root.addChild(mesh);
            continue;
          }
          const spec = data.materials[data.material[i] ?? 0];
          const shared = materials[data.material[i] ?? 0];
          const own =
            ownMaps && spec
              ? ownMaterialOf(spec)
              : mode === 'spawn' && spec && shared
                ? spawnMaterialOf(spec, shared)
                : null;
          const fresh = new Mesh3D({
            geometry: mesh.geometry,
            material: own ?? mesh.material,
            castShadow: shadows,
            receiveShadow: shadows,
          });
          fresh.position.copyFrom(mesh.position);
          fresh.scale.copyFrom(mesh.scale);
          fresh.quaternion.copyFrom(mesh.quaternion);
          mesh.destroy();
          ownMaterial[i]?.destroy(ownMaps);
          ownMaterial[i] = own;
          view.root.addChild(fresh);
          meshes[i] = fresh;
        }
        lastFrame = frameIndex;
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy(true);
        for (const material of ownMaterial) material?.destroy(ownMaps);
        for (const material of blinkMaterials) material.destroy(true);
      },
    };
  },
});
