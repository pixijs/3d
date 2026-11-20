/**
 * `shadow masks`: what alpha-tested casters cost in a shadow map, and how much of it is the material's other
 * textures. The `shadows` scene's 2000 spinning casters under its sun, each drawn with one of 64 mask-mode
 * materials (`alphaMode: 'mask'`), every material with a perforated base-colour texture of its own, so no two
 * materials share a texture set and the shadow pass binds a material for every run it draws.
 *
 * The variants are a two by two, plus a control. `t1` and `t5` are the textures a material holds: the base colour
 * alone, or the base colour with a normal, a metallic-roughness, an occlusion and an emissive map. The shadow pass
 * reads only the base colour's alpha in both. `-off` is the same scene with the sun not casting, so a variant less
 * its `-off` is what its shadow map cost, and `t5`'s cost less `t1`'s is what the four maps the shadow never reads
 * add to it. `opaque` is `t1` with the materials opaque: the same casters with whole shadows and nothing bound.
 *
 * Judged on `gpu.frame`, with `cpu.render` and `cpu.interval` beside it: a bound texture the shader never samples
 * costs the GPU nothing, so what it costs is in the submission.
 */

import { Box, DirectionalLight, Material3D, Mesh3D, Vector3 } from '@pixi/3d';
import type { ShadowQuality } from '@pixi/3d';
import { frame } from 'benchy';
import type { Texture } from 'pixi.js';

import { alphaTexture } from './data/cloud.ts';
import { shadowsScene } from './data/shadows.ts';
import { proceduralMaps } from './data/textures.ts';
import { applyLook, displayColor, LIGHT_SCALE, toGeometry, toMaterial, toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** The mask materials the casters are spread over, each with a base-colour texture of its own. */
const MATERIALS = 64;

/** The view's map presets by size: every map a view renders is one of these. */
const QUALITY: Record<number, ShadowQuality> = { 512: 'low', 1024: 'medium', 2048: 'high', 4096: 'ultra' };

/** Four by four round holes, their size set by `index` so every material's texture is its own. */
function perforated(index: number): Texture {
  const radius = 0.12 + 0.12 * (index / MATERIALS);
  const texture = alphaTexture(64, (u, v) => {
    const x = ((u * 4) % 1) - 0.5;
    const y = ((v * 4) % 1) - 0.5;
    return Math.hypot(x, y) < radius ? 0 : 1;
  });
  return toTexture(texture, `shadow-mask-${index}`);
}

frame('shadow masks', {
  variants: {
    t1: { textures: 1, casting: true, mask: true },
    t5: { textures: 5, casting: true, mask: true },
    't1-off': { textures: 1, casting: false, mask: true },
    't5-off': { textures: 5, casting: false, mask: true },
    opaque: { textures: 1, casting: true, mask: false },
  },
  primary: 'gpu.frame',
  options: { cull: 'cpu' },
  create(stage: PixiStage, { textures, casting, mask }: { textures: number; casting: boolean; mask: boolean }) {
    const data = shadowsScene();
    applyLook(stage, data.look);
    const { view } = stage;
    const { shadow } = data;
    const quality = QUALITY[shadow.size];
    if (quality === undefined) throw new Error(`shadow masks: no shadow-map preset of ${shadow.size} texels`);
    view.shadowQuality = quality;
    view.shadowFilter = 'pcf';

    const white = alphaTexture(4, () => 1);
    const maps: Texture[] = [];
    const map = (texture: Texture): Texture => {
      maps.push(texture);
      return texture;
    };
    // The four maps the shadow never reads, shared by every material: only the base colour is a material's own.
    const extras =
      textures === 5
        ? {
            normalTexture: map(toTexture(proceduralMaps(0).normal, 'shadow-mask-normal')),
            metallicRoughnessTexture: map(toTexture(white, 'shadow-mask-metallic-roughness')),
            occlusionTexture: map(toTexture(white, 'shadow-mask-occlusion')),
            emissiveTexture: map(toTexture(white, 'shadow-mask-emissive')),
          }
        : {};
    const geometries = data.geometries.map(toGeometry);
    const materials: Material3D[] = [];
    for (let i = 0; i < MATERIALS; i++) {
      materials.push(
        new Material3D({
          baseColor: displayColor([0.3 + 0.6 * (i / MATERIALS), 0.6, 0.9 - 0.6 * (i / MATERIALS)]),
          roughness: 0.6,
          metallic: 0,
          baseColorTexture: map(perforated(i)),
          alphaMode: mask ? 'mask' : 'opaque',
          alphaCutoff: 0.5,
          ...extras,
        }),
      );
    }

    const meshes: Mesh3D[] = [];
    for (let i = 0; i < data.count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[i % MATERIALS];
      if (!geometry || !material) throw new Error(`shadow masks: caster ${i} has no geometry or material`);
      const mesh = new Mesh3D({ geometry, material, castShadow: true, receiveShadow: true });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      meshes.push(view.root.addChild(mesh));
    }
    const groundGeometry = toGeometry(data.ground.geometry);
    const groundMaterial = toMaterial(data.ground.material);
    view.root.addChild(
      new Mesh3D({ geometry: groundGeometry, material: groundMaterial, castShadow: false, receiveShadow: true }),
    );

    const spec = data.sun;
    const sun = new DirectionalLight({
      color: displayColor(spec.color),
      intensity: spec.intensity * LIGHT_SCALE,
      castShadow: casting,
    });
    const [dx, dy, dz] = spec.direction;
    sun.position.set(-dx * spec.distance, -dy * spec.distance, -dz * spec.distance);
    sun.lookAt({ x: 0, y: 0, z: 0 });
    sun.shadow.bias = shadow.bias;
    sun.shadow.normalBias = shadow.normalBias;
    sun.shadow.bounds = new Box(new Vector3(...spec.box.min), new Vector3(...spec.box.max));
    view.root.addChild(sun);

    const quat = data.quat;
    return {
      simulate(seconds) {
        data.update(seconds);
      },
      update() {
        let at = 0;
        for (const mesh of meshes) {
          mesh.quaternion.fromArray(quat, at);
          at += 4;
        }
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy();
        for (const texture of maps) texture.destroy(true);
        groundGeometry.destroy(true);
        groundMaterial.destroy();
      },
    };
  },
});
