/**
 * The PBR material scene (`data/pbr.ts`): five `Mesh3D` strips, each with its own `Geometry3D` and
 * `Material3D`, the four textures of each from one pool of ten noise fields, a solid-colour environment and the
 * point lights, in a view with no ambient light and no sun. `pbr-lighting` draws it.
 */

import { ColorCubeTexture, Geometry3D, Material3D, Mesh3D, PointLight } from '@pixi/3d';
import type { GpuScene } from 'benchy';
import { BufferImageSource, Texture } from 'pixi.js';

import {
  CAMERA,
  ENVIRONMENT_RGB,
  MESH_COUNT,
  noisePixels,
  pbrLights,
  pbrMaterial,
  strip,
  TEXTURE_POOL,
  TEXTURE_SIZE,
} from './data/pbr.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** The `Material3D` options this scene sets, beyond the untextured ones. */
interface TexturedMaterialOptions {
  roughness: number;
  metallic: number;
  baseColorTexture: Texture;
  metallicRoughnessTexture: Texture;
  occlusionTexture: Texture;
  normalTexture: Texture;
}

/** A noise field with a full mip chain, built by the engine's own texture path. */
function noiseTexture(seed: number): Texture {
  const label = `pbr-noise-${seed}`;
  const source = new BufferImageSource({
    resource: noisePixels(TEXTURE_SIZE, seed),
    width: TEXTURE_SIZE,
    height: TEXTURE_SIZE,
    format: 'rgba8unorm',
    autoGenerateMipmaps: true,
    label,
  });
  return new Texture({ source, label });
}

function material(pool: Texture[], index: number): Material3D {
  const spec = pbrMaterial(index);
  const texture = (slot: number): Texture => {
    const found = pool[slot];
    if (!found) throw new Error('pbr: the texture pool is empty');
    return found;
  };
  const options: TexturedMaterialOptions = {
    roughness: spec.roughness,
    metallic: spec.metallic,
    baseColorTexture: texture(spec.textures.baseColor),
    metallicRoughnessTexture: texture(spec.textures.metallicRoughness),
    occlusionTexture: texture(spec.textures.occlusion),
    normalTexture: texture(spec.textures.normal),
  };
  return new Material3D(options);
}

/** Builds the scene with `lights` point lights, and returns the release of what it made. */
export function pbrScene(stage: PixiStage, lights: number): GpuScene {
  applyLook(stage, {
    camera: { position: [0, 0, CAMERA.distance], target: [0, 0, 0], fovY: CAMERA.fovY, near: 0.1, far: 100 },
    clearColor: [0, 0, 0],
    ambient: null,
    sun: null,
  });
  const { view } = stage;
  const [r, g, b] = ENVIRONMENT_RGB;
  const environment = ColorCubeTexture.fromRGB(r, g, b);
  view.environment = environment;
  for (const light of pbrLights(lights)) {
    const point = new PointLight({ color: light.color, intensity: light.intensity, range: light.range });
    point.position.set(...light.position);
    view.root.addChild(point);
  }
  const pool = Array.from({ length: TEXTURE_POOL }, (_, seed) => noiseTexture(seed));
  const geometries: Geometry3D[] = [];
  const materials: Material3D[] = [];
  for (let index = 0; index < MESH_COUNT; index++) {
    const geometry = new Geometry3D(strip(index));
    const made = material(pool, index);
    geometries.push(geometry);
    materials.push(made);
    view.root.addChild(new Mesh3D({ geometry, material: made, castShadow: false, receiveShadow: false }));
  }
  return {
    destroy() {
      for (const geometry of geometries) geometry.destroy(true);
      for (const made of materials) made.destroy();
      for (const texture of pool) texture.destroy(true);
      environment.destroy(true);
    },
  };
}
