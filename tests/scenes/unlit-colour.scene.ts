import type { TestScene } from '@test-utils';
import { BufferImageSource, Color, Graphics, Sprite, Texture } from 'pixi.js';
import type { Container } from 'pixi.js';

import { PortalMaterial } from '~/extras/materials/portal/PortalMaterial';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import type { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

const SWATCH = 64;
const ROW_PITCH = 80;
const TOP = 24;
const TEXEL = 0xc0e0ff;
const TINT = 0xffc080;

function solidTexture(color: number): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([...new Color(color).toUint8RgbArray(), 255]),
      format: 'rgba8unorm',
      width: 1,
      height: 1,
    }),
  });
}

export const scene: TestScene = {
  app: { backgroundColor: 0x101418 },
  create: async (app) => {
    const { width, height } = app.screen;
    const half = width / 2;
    const view3d = new View3D({ width: half, height, toneMapping: 'none' });

    view3d.position.set(half, 0);
    view3d.camera.useOrthographic(half / 2);
    view3d.camera.position.set(0, 0, 10);
    app.stage.addChild(view3d);

    const geometry = new PlaneGeometry({ width: SWATCH, height: SWATCH });
    const fill = (color: number): Graphics => new Graphics().rect(0, 0, SWATCH, SWATCH).fill(color);
    const tintedSprite = (): Sprite =>
      new Sprite({ texture: solidTexture(TEXEL), tint: TINT, width: SWATCH, height: SWATCH });
    const quad = (material: BaseMaterial3D): Mesh3D => new Mesh3D({ geometry, material, castShadow: false });
    const addRow = (row: number, flat: Container, deep: Container3D): void => {
      const top = TOP + row * ROW_PITCH;

      flat.position.set(half - SWATCH, top);
      deep.position.set(SWATCH / 2 - half / 2, height / 2 - top - SWATCH / 2, 0);
      app.stage.addChild(flat);
      view3d.root.addChild(deep);
    };

    const particles = new ParticleContainer3D({ capacity: 1, alphaMode: 'opaque', space: 'local' });

    particles.setParticleAt(0, 0, 0, 0, SWATCH, 0, 0x336699, 1);
    particles.upload();

    const system = new ParticleSystem3D({
      capacity: 1,
      alphaMode: 'opaque',
      space: 'local',
      autoUpdate: false,
      life: 1,
      size: SWATCH,
      color: 0xc86428,
      colorEnd: 0x28a0dc,
    });

    system.spawn(1);
    system.time = 0.5;
    system.upload();

    addRow(0, fill(0xff8040), quad(new FlatMaterial({ baseColor: 0xff8040 })));
    addRow(1, tintedSprite(), quad(new FlatMaterial({ baseColorTexture: solidTexture(TEXEL), baseColor: TINT })));
    addRow(
      2,
      tintedSprite(),
      new Sprite3D({ texture: solidTexture(TEXEL), tint: TINT, width: SWATCH, height: SWATCH }),
    );
    addRow(3, fill(0x336699), particles);
    addRow(4, fill(0x788282), system);
    addRow(5, tintedSprite(), quad(new PortalMaterial({ texture: solidTexture(TEXEL), baseColor: TINT })));
  },
};
