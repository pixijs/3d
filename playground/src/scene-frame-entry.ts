import type { TestScene } from '../../tests/test-utils';
import { forcePreference } from './scenes/forcePreference';
import type { RenderType } from './types';

const playgroundGlobs = import.meta.glob('../**/*.playground.ts');
const visualTestGlobs = import.meta.glob('../../tests/scenes/**/*.scene.ts');
const exampleGlobs = import.meta.glob([
  '../../examples/*.ts',
  '../../examples/*/index.ts',
  '../../examples/**/*.example.ts',
  '../../src/**/__docs__/examples/*.ts',
  '../../src/**/__docs__/examples/*/index.ts',
]);

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function deriveId(filename: string): string {
  return filename.toLowerCase().replaceAll('.', '-');
}

const playgroundById: Map<string, () => Promise<unknown>> = new Map();

for (const [path, loader] of Object.entries(playgroundGlobs)) {
  const name = basename(path).replace('.playground.ts', '');

  playgroundById.set(name, loader as () => Promise<unknown>);
}

const visualTestById: Map<string, () => Promise<unknown>> = new Map();

for (const [path, loader] of Object.entries(visualTestGlobs)) {
  const id = deriveId(basename(path));

  visualTestById.set(id, loader as () => Promise<unknown>);
}

const exampleById: Map<string, () => Promise<unknown>> = new Map();
const docsExampleIds = new Set<string>();

for (const [path, loader] of Object.entries(exampleGlobs)) {
  const filename = basename(path);

  let id: string;

  if (filename.endsWith('.example.ts')) {
    id = filename.replace('.example.ts', '');
  } else if (filename === 'index.ts') {
    id = path.split('/').at(-2)!;
  } else {
    id = filename.replace('.ts', '');
  }

  exampleById.set(id, loader as () => Promise<unknown>);
  if (path.includes('/__docs__/examples/')) docsExampleIds.add(id);
}

const params = new URLSearchParams(location.search);
const type = params.get('type');
const id = params.get('id');
const rendererType = (params.get('renderer') ?? 'webgl') as RenderType;

try {
  if (type === 'playground' && id) {
    const loader = playgroundById.get(id);

    if (loader) {
      const mod = (await loader()) as { default?: () => Promise<void> };

      if (typeof mod.default === 'function') await mod.default();
    }
  } else if (type === 'example' && id) {
    const loader = exampleById.get(id);

    if (loader) {
      if (docsExampleIds.has(id)) forcePreference(rendererType);
      await loader();
    }
  } else if (type === 'visual-test' && id) {
    const loader = visualTestById.get(id);

    if (loader) {
      const { runScene } = await import('./scenes/sceneRunner');
      const mod = (await loader()) as { scene: TestScene };
      const canvas = await runScene(mod.scene, rendererType);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const bitmap = await createImageBitmap(canvas);

      window.parent.postMessage({ type: 'scene-result', bitmap }, '*', [bitmap]);
    }
  }
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);

  window.parent.postMessage({ type: 'scene-error', message }, '*');
}
