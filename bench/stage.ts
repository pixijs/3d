/**
 * What every bench here shares: the stage a bench is handed, typed, the scene's look applied to it, and the scene
 * data as pixi-3d objects (colours, geometries, materials, textures), so each bench file only says what its scene
 * does.
 */

import { Geometry3D, Material3D } from '@pixi/3d';
import type { AmbientLight, DirectionalLight, PointLight, View3D } from '@pixi/3d';
import type { FrameStage } from 'benchy';
import { BufferImageSource, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';

import type { PixelTexture } from './data/cloud.ts';
import type { Geometry } from './data/geometry.ts';
import type { PbrSpec, SceneLook, Vec3 } from './data/look.ts';
import { proceduralMaps } from './data/textures.ts';

/**
 * The pixi-3d stage: the renderer, the view, and the lights it made. It comes up framed as `field` is, with an
 * ambient light and a sun; `applyLook` reframes it for a scene with a look of its own.
 */
export type PixiStage = FrameStage<{
  renderer: Renderer;
  view: View3D;
  lights: { ambient: AmbientLight; sun: DirectionalLight; points: PointLight[] };
}>;

/**
 * Data light units to engine units. The engine's diffuse term is albedo/π for ambient and punctual lights alike,
 * which is the convention the data is written in, so intensities carry straight across once scaled.
 */
export const LIGHT_SCALE = Math.PI;

/** Linear to display-encoded, because the engine decodes the colours it is given. */
function linearToDisplay(value: number): number {
  return value <= 0.003_130_8 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/** A linear colour from the data, as the engine takes it. */
export function displayColor(color: Readonly<Vec3>, scale = 1): Vec3 {
  return [linearToDisplay(color[0] * scale), linearToDisplay(color[1] * scale), linearToDisplay(color[2] * scale)];
}

export function toGeometry(geometry: Geometry): Geometry3D {
  return new Geometry3D({
    positions: geometry.positions,
    normals: geometry.normals,
    uvs: geometry.uvs,
    indices: geometry.indices,
  });
}

/** A material from the data, with its map pair when it names one; `destroy(true)` releases the maps. */
export function toMaterial(material: PbrSpec): Material3D {
  const options = {
    baseColor: displayColor(material.color),
    roughness: material.roughness,
    metallic: material.metalness,
  };
  if (material.texture === undefined) return new Material3D(options);
  const maps = proceduralMaps(material.texture);
  return new Material3D({
    ...options,
    baseColorTexture: toTexture(maps.albedo, `albedo-${material.texture}`),
    normalTexture: toTexture(maps.normal, `normal-${material.texture}`),
  });
}

/**
 * A texture the data built as bytes, uploaded through pixi's own texture path with a full mip chain.
 *
 * pixi-3d reads a texture's colour as premultiplied by its alpha. pixi premultiplies a byte upload itself only on
 * WebGL, so the bytes are premultiplied here and uploaded as they are, which draws the same texels on both
 * backends.
 */
export function toTexture(texture: PixelTexture, label: string): Texture {
  const pixels = texture.pixels.slice();
  for (let at = 0; at < pixels.length; at += 4) {
    const alpha = (pixels[at + 3] ?? 0) / 255;
    for (let channel = at; channel < at + 3; channel++) pixels[channel] = Math.round((pixels[channel] ?? 0) * alpha);
  }
  const source = new BufferImageSource({
    resource: pixels,
    width: texture.width,
    height: texture.height,
    format: 'rgba8unorm',
    autoGenerateMipmaps: true,
    alphaMode: 'premultiplied-alpha',
    label,
  });
  return new Texture({ source, label });
}

/** How far back along its direction the sun sits, aimed at the origin. */
const SUN_DISTANCE = 50;

/**
 * Points the camera and sets the backdrop the way `look` says, and retunes the stage's ambient light and sun to
 * it, or removes the one the look has none of. A light removed before the first frame is one the view never
 * compiled for.
 */
export function applyLook({ renderer, view, lights }: PixiStage, look: SceneLook): void {
  const { camera } = view;
  const spec = look.camera;
  camera.fov = spec.fovY;
  camera.near = spec.near;
  camera.far = spec.far;
  camera.position.set(spec.position[0], spec.position[1], spec.position[2]);
  camera.lookAt({ x: spec.target[0], y: spec.target[1], z: spec.target[2] });
  // The renderer's clear is the backdrop the view draws over, and it reaches the canvas unencoded.
  renderer.background.color = displayColor(look.clearColor);

  if (look.ambient) {
    lights.ambient.color.setValue(displayColor(look.ambient.color));
    lights.ambient.intensity = look.ambient.intensity * LIGHT_SCALE;
  } else {
    lights.ambient.destroy();
  }

  if (look.sun) {
    const { color, intensity, direction } = look.sun;
    lights.sun.color.setValue(displayColor(color));
    lights.sun.intensity = intensity * LIGHT_SCALE;
    // A light emits along its local -Z, so it is put at the far end of the direction it lights and aimed back at
    // the origin.
    lights.sun.position.set(-direction[0] * SUN_DISTANCE, -direction[1] * SUN_DISTANCE, -direction[2] * SUN_DISTANCE);
    lights.sun.lookAt({ x: 0, y: 0, z: 0 });
  } else {
    lights.sun.destroy();
  }
}
