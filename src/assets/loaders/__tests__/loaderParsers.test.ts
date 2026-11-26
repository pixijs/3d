import { captureWarnings } from '@test-utils';
import { BrowserAdapter, CubeTexture, DOMAdapter, Loader } from 'pixi.js';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { loadCubemap } from '~/assets/loaders/cubemap/loadCubemap';
import { packGlb, pngBytes, textureLoader } from '~/assets/loaders/gltf/__tests__/gltfFixtures';
import { loadGlb } from '~/assets/loaders/gltf/loadGlb';
import { loadGltf } from '~/assets/loaders/gltf/loadGltf';
import { loadHdr } from '~/assets/loaders/hdr/loadHdr';
import { Scene3DSource } from '~/assets/Scene3DSource';

const TRIANGLE_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const TRIANGLE_INDICES_DATA_URI = 'data:application/octet-stream;base64,AAABAAIA';

function serveThroughAdapter(files: Record<string, BodyInit>): void {
  const pageFetch = globalThis.fetch.bind(globalThis);

  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('this host serves requests only through its adapter')));
  DOMAdapter.set({
    ...BrowserAdapter,
    fetch: (url, options) => {
      const href = url instanceof Request ? url.url : url;

      return href in files ? Promise.resolve(new Response(files[href])) : pageFetch(url, options);
    },
  });
  onTestFinished(() => {
    DOMAdapter.set(BrowserAdapter);
    vi.unstubAllGlobals();
  });
}

async function loadAndUnload<T>(loader: Loader, src: string): Promise<T> {
  const asset = await loader.load<T>(src);

  onTestFinished(() => loader.unload(src));

  return asset;
}

describe('3D loader parsers', () => {
  it("pass the loader's parser validation together", () => {
    const loader = new Loader();
    loader.parsers.push(loadGltf, loadGlb, loadCubemap);

    const warnings = captureWarnings(() => (loader as unknown as { _validateParsers(): void })._validateParsers());
    expect(warnings).toEqual([]);
  });

  it('match their extension regardless of case or query string', () => {
    expect(loadGltf.test('models/Robot.GLTF?v=2')).toBe(true);
    expect(loadGlb.test('models/robot.glb?v=2')).toBe(true);
    expect(loadCubemap.test('env/sky.cubemap?v=2')).toBe(true);

    expect(loadGltf.test('models/robot.glb')).toBe(false);
    expect(loadGlb.test('models/robot.gltf')).toBe(false);
  });

  it('match glTF data URLs by mime type', () => {
    expect(loadGltf.test('data:model/gltf+json;base64,e30=')).toBe(true);
    expect(loadGlb.test('data:model/gltf-binary;base64,Z2xURg==')).toBe(true);
  });

  it('loads an extensionless URL when the parser is forced by id', async () => {
    const loader = new Loader();
    loader.parsers.push(loadGltf, loadGlb, loadCubemap);

    const url = URL.createObjectURL(new Blob([JSON.stringify({ asset: { version: '2.0' } })]));

    try {
      const source = await loader.load<Scene3DSource>({ src: url, parser: 'gltf' });

      expect(source).toBeInstanceOf(Scene3DSource);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});

describe("3D loader parsers under a host's DOMAdapter", () => {
  it('load a .gltf, its external buffer and its data URI buffer through the adapter', async () => {
    const gltf = {
      asset: { version: '2.0' },
      buffers: [
        { uri: 'triangle.bin', byteLength: 36 },
        { uri: TRIANGLE_INDICES_DATA_URI, byteLength: 6 },
      ],
      bufferViews: [
        { buffer: 0, byteLength: 36 },
        { buffer: 1, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    };
    serveThroughAdapter({
      'host://models/triangle.gltf': JSON.stringify(gltf),
      'host://models/triangle.bin': TRIANGLE_POSITIONS,
    });
    const loader = new Loader();
    loader.parsers.push(loadGltf);

    const source = await loadAndUnload<Scene3DSource>(loader, 'host://models/triangle.gltf');
    const [triangle] = source.geometries[0];

    expect(Array.from(triangle.positions)).toEqual(Array.from(TRIANGLE_POSITIONS));
    expect(Array.from(triangle.indices)).toEqual([0, 1, 2]);
  });

  it('load a .glb through the adapter', async () => {
    const gltf = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    };
    serveThroughAdapter({
      'host://models/triangle.glb': packGlb(gltf, new Uint8Array(TRIANGLE_POSITIONS.buffer)),
    });
    const loader = new Loader();
    loader.parsers.push(loadGlb);

    const source = await loadAndUnload<Scene3DSource>(loader, 'host://models/triangle.glb');

    expect(Array.from(source.geometries[0][0].positions)).toEqual(Array.from(TRIANGLE_POSITIONS));
  });

  it('load a .cubemap through the adapter', async () => {
    const png = await pngBytes();
    serveThroughAdapter({
      'host://env/sky.cubemap': JSON.stringify({
        right: 'face.png',
        left: 'face.png',
        top: 'face.png',
        bottom: 'face.png',
        front: 'face.png',
        back: 'face.png',
      }),
      'host://env/face.png': png,
    });

    const cube = await loadAndUnload<CubeTexture>(textureLoader(loadCubemap), 'host://env/sky.cubemap');

    expect(cube).toBeInstanceOf(CubeTexture);
  });

  it('load a .hdr through the adapter', async () => {
    serveThroughAdapter({
      'host://env/sky.hdr': new Blob([
        '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n',
        new Uint8Array([128, 128, 128, 129]),
      ]),
    });
    const loader = new Loader();
    loader.parsers.push(loadHdr);

    const sky = await loadAndUnload<CubeTexture>(loader, 'host://env/sky.hdr');

    expect(sky).toBeInstanceOf(CubeTexture);
  });
});
