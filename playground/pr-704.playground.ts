/**
 * PR #704: unlit materials show colours as authored
 *
 * Each row has a pixi 2D swatch on the left and an unlit 3D one on the right, so a matching row
 * reads as one even bar. The last row's 3D side is a FlatMaterial with an extra bit that writes
 * `finalColor`, which draws red. The buttons change the view live. At exposure 1 with no fog the
 * bars stay even under toneMapping 'none'. The other curves shift the 3D side as they shift a lit
 * scene, except the portal, whose feed the view curved already. 'custom' leaves linear light for a
 * post effect and draws dark here. Exposure scales the 3D side and fog fades it towards grey.
 */

import type { BaseMaterial3D, Container3D, Fog, ShaderBit, ToneMapping } from '@pixi/3d';
import { FlatMaterial, Mesh3D, ParticleContainer3D, PlaneGeometry, Sprite3D, View3D } from '@pixi/3d';
import { ParticleSystem3D, PortalMaterial } from '@pixi/3d/extras';
import { Application, BufferImageSource, Color, Graphics, Sprite, Texture } from 'pixi.js';
import type { Container } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

const WIDTH = 512;
const HEIGHT = 608;
const SWATCH = 64;
const ROW_PITCH = 80;
const TOP = 48;
const TEXEL = 0xc0e0ff;
const TINT = 0xffc080;
const FOG: Fog = { type: 'linear', color: 0x808080, near: 5, far: 15 };
const TONE_MAPPINGS: ToneMapping[] = ['none', 'aces', 'reinhard', 'uncharted2', 'custom'];

const writesRedBit: ShaderBit = {
  name: 'pr704WritesRed',
  gpu: { fragment: { lighting: 'finalColor = vec3<f32>(1.0, 0.0, 0.0);' } },
  gl: { fragment: { lighting: 'finalColor = vec3(1.0, 0.0, 0.0);' } },
};

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

function addControl<T>(panel: HTMLElement, label: string, values: readonly T[], apply: (value: T) => void): void {
  const button = document.createElement('button');
  let index = 0;
  const show = (): void => {
    apply(values[index]);
    button.textContent = `${label}: ${String(values[index])}`;
  };

  button.onclick = () => {
    index = (index + 1) % values.length;
    show();
  };
  panel.appendChild(button);
  show();
}

export default async function () {
  const app = new Application();

  await app.init({ width: WIDTH, height: HEIGHT, preference: rendererPreference, backgroundColor: 0x101418 });
  document.body.appendChild(app.canvas);

  const view3d = new View3D({ width: WIDTH / 2, height: HEIGHT });

  view3d.position.set(WIDTH / 2, 0);
  view3d.camera.useOrthographic(WIDTH / 4);
  view3d.camera.position.set(0, 0, 10);
  app.stage.addChild(view3d);

  const geometry = new PlaneGeometry({ width: SWATCH, height: SWATCH });
  const fill = (color: number): Graphics => new Graphics().rect(0, 0, SWATCH, SWATCH).fill(color);
  const tintedSprite = (): Sprite =>
    new Sprite({ texture: solidTexture(TEXEL), tint: TINT, width: SWATCH, height: SWATCH });
  const quad = (material: BaseMaterial3D): Mesh3D => new Mesh3D({ geometry, material, castShadow: false });

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

  const rows: [Container, Container3D][] = [
    [fill(0xff8040), quad(new FlatMaterial({ baseColor: 0xff8040 }))],
    [tintedSprite(), quad(new FlatMaterial({ baseColorTexture: solidTexture(TEXEL), baseColor: TINT }))],
    [tintedSprite(), new Sprite3D({ texture: solidTexture(TEXEL), tint: TINT, width: SWATCH, height: SWATCH })],
    [fill(0x336699), particles],
    [fill(0x788282), system],
    [tintedSprite(), quad(new PortalMaterial({ texture: solidTexture(TEXEL), baseColor: TINT }))],
    [fill(0xff0000), quad(new FlatMaterial({ baseColor: 0x808080, extraBits: [writesRedBit] }))],
  ];

  rows.forEach(([flat, deep], row) => {
    const top = TOP + row * ROW_PITCH;

    flat.position.set(WIDTH / 2 - SWATCH, top);
    deep.position.set(SWATCH / 2 - WIDTH / 4, HEIGHT / 2 - top - SWATCH / 2, 0);
    app.stage.addChild(flat);
    view3d.root.addChild(deep);
  });

  const panel = document.createElement('div');

  panel.style.cssText = 'position:fixed;top:8px;left:8px;display:flex;gap:8px';
  document.body.appendChild(panel);
  addControl(panel, 'toneMapping', TONE_MAPPINGS, (mode) => {
    view3d.toneMapping = mode;
  });
  addControl(panel, 'exposure', [1, 2.5, 0.5], (exposure) => {
    view3d.exposure = exposure;
  });
  addControl(panel, 'fog', [false, true], (on) => {
    view3d.fog = on ? FOG : null;
  });
}
