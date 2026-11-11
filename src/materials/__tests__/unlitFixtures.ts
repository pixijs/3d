import { BufferImageSource, Color, Texture } from 'pixi.js';

import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';

export function solidTexture(color: number, alpha = 255): Texture {
  const [r, g, b] = new Color(color).toUint8RgbArray();
  const a = alpha / 255;
  const data = new Uint8Array(4 * 4 * 4);

  for (let i = 0; i < data.length; i += 4) data.set([r * a, g * a, b * a, alpha], i);

  return new Texture({ source: new BufferImageSource({ resource: data, format: 'rgba8unorm', width: 4, height: 4 }) });
}

export const plane = (material: BaseMaterial3D): Mesh3D =>
  new Mesh3D({ geometry: new PlaneGeometry({ width: 20, height: 20 }), material, castShadow: false });

export function oneParticle(color: number, texture?: Texture): ParticleContainer3D {
  const particles = new ParticleContainer3D({ capacity: 1, alphaMode: 'opaque', texture });

  particles.setParticleAt(0, 0, 0, 0, 20, 0, color, 1);
  particles.upload();

  return particles;
}

export function halfLifeParticle(color: number, colorEnd: number): ParticleSystem3D {
  const system = new ParticleSystem3D({
    capacity: 1,
    alphaMode: 'opaque',
    autoPlay: false,
    autoUpdate: false,
    emitRate: 0,
    life: 1,
    size: 20,
    color,
    colorEnd,
  });

  system.spawn(1);
  system.time = 0.5;
  system.upload();

  return system;
}
