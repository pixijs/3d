import { Material3D, Mesh3D, SphereGeometry, View3D } from '@pixi/3d';
import { Application, BufferImageSource, CubeTexture, Texture } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

const FACE_SIZE = 256;
const DISC_RADIANCE = 20;
const DISC_COS = Math.cos((6 * Math.PI) / 180);
const DISC_DIRECTION = [0.28, 0.2, 0.94];

const FACE_DIRECTIONS: ((u: number, v: number) => number[])[] = [
  (u, v) => [1, -v, -u],
  (u, v) => [-1, -v, u],
  (u, v) => [u, 1, v],
  (u, v) => [u, -1, -v],
  (u, v) => [u, -v, 1],
  (u, v) => [-u, -v, -1],
];

// `Math.abs(z)` repeats the disc behind the camera, where a mirror reflects it.
function radiance([x, y, z]: number[]): number {
  const length = Math.hypot(x, y, z);
  const facing = (x * DISC_DIRECTION[0] + y * DISC_DIRECTION[1] + Math.abs(z) * DISC_DIRECTION[2]) / length;
  return facing > DISC_COS ? DISC_RADIANCE : 0.08 + 0.12 * (y / length + 1);
}

function toHalfFloat(value: number): number {
  const exponent = Math.floor(Math.log2(value));
  return ((exponent + 15) << 10) + Math.round((value / 2 ** exponent - 1) * 1024);
}

function buildCube(format: 'rgba16float' | 'rgba8unorm'): CubeTexture {
  const faces = FACE_DIRECTIONS.map((direction) => {
    const resource =
      format === 'rgba16float' ? new Uint16Array(FACE_SIZE ** 2 * 4) : new Uint8Array(FACE_SIZE ** 2 * 4);
    const opaque = format === 'rgba16float' ? toHalfFloat(1) : 255;
    for (let row = 0; row < FACE_SIZE; row++) {
      for (let column = 0; column < FACE_SIZE; column++) {
        const light = radiance(direction(((column + 0.5) / FACE_SIZE) * 2 - 1, ((row + 0.5) / FACE_SIZE) * 2 - 1));
        const texel = format === 'rgba16float' ? toHalfFloat(light) : Math.round(255 * Math.min(1, light) ** (1 / 2.2));
        resource.set([texel, texel, texel, opaque], (row * FACE_SIZE + column) * 4);
      }
    }
    return new Texture({ source: new BufferImageSource({ resource, format, width: FACE_SIZE, height: FACE_SIZE }) });
  });
  const [right, left, top, bottom, front, back] = faces;

  return CubeTexture.from({ faces: { right, left, top, bottom, front, back } });
}

/**
 * PR #702: float environment cubes keep radiance above 1 through the IBL prefilter and the sky
 *
 * Both cubes hold the same picture: a dim sky with a small disc at radiance 20. The 8-bit one
 * clamps the disc to 1. Drag exposure down: the float disc stays bright in the sky and in the
 * mirror on the left, and the 8-bit disc goes grey. Compare `renderer=webgpu` with `renderer=webgl`.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, autoDensity: true });
  document.body.appendChild(app.canvas);

  const float = buildCube('rgba16float');
  const eightBit = buildCube('rgba8unorm');
  const view3d = new View3D({ autoResize: true, toneMapping: 'none', environment: float, background: float });
  app.stage.addChild(view3d);

  const geometry = new SphereGeometry({ radius: 0.45, widthSegments: 48, heightSegments: 32 });
  [0, 0.3, 0.7].forEach((roughness, i) => {
    const material = new Material3D({ baseColor: 0xffffff, metallic: 1, roughness });
    const sphere = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
    sphere.position.set((i - 1) * 1.1, 0, 0);
    view3d.root.addChild(sphere);
  });
  view3d.camera.position.set(0, 0, 3.4);

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:12px;top:12px;z-index:10;display:flex;gap:12px;align-items:center;' +
    'padding:8px;font:13px monospace;color:#fff;background:rgba(0,0,0,.7);';
  const toggle = document.createElement('button');
  const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0.01', max: '1', step: '0.01' });
  const exposureLabel = document.createElement('span');
  panel.append(toggle, 'exposure', slider, exposureLabel);
  document.body.appendChild(panel);

  const showCube = (cube: CubeTexture) => {
    view3d.environment = cube;
    view3d.background = cube;
    toggle.textContent = cube === float ? 'float (rgba16float)' : '8-bit (rgba8unorm)';
  };
  const setExposure = (exposure: number) => {
    view3d.exposure = exposure;
    slider.value = String(exposure);
    exposureLabel.textContent = exposure.toFixed(2);
  };

  toggle.addEventListener('click', () => showCube(view3d.background === float ? eightBit : float));
  slider.addEventListener('input', () => setExposure(Number(slider.value)));
  showCube(float);
  setExposure(0.1);
}
