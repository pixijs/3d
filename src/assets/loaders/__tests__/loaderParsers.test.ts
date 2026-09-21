import { captureWarnings } from '@test-utils';
import { Loader } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { loadCubemap } from '~/assets/loaders/cubemap/loadCubemap';
import { loadGlb } from '~/assets/loaders/gltf/loadGlb';
import { loadGltf } from '~/assets/loaders/gltf/loadGltf';
import { Scene3DSource } from '~/assets/Scene3DSource';

describe('3D loader parsers', () => {
  it('each has an id to force it with', () => {
    expect([loadGltf.id, loadGlb.id, loadCubemap.id]).toEqual(['gltf', 'glb', 'cubemap']);
  });

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
