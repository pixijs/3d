import type { SceneEntry } from '../types';

const playgroundGlobs = import.meta.glob('../../**/*.playground.ts');
const visualTestGlobs = import.meta.glob('../../../tests/scenes/**/*.scene.ts');
const exampleGlobs = import.meta.glob([
  '../../../examples/*.ts',
  '../../../examples/*/index.ts',
  '../../../examples/**/*.example.ts',
]);

function deriveId(filename: string): string {
  return filename.toLowerCase().replaceAll('.', '-');
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function deriveCategory(path: string): string {
  const parts = path.split('/');
  const scenesIdx = parts.indexOf('scenes');

  if (scenesIdx >= 0 && scenesIdx < parts.length - 2) {
    return parts.slice(scenesIdx + 1, -1).join('/');
  }

  return 'uncategorized';
}

export function discoverScenes(): SceneEntry[] {
  const entries: SceneEntry[] = [];

  for (const path of Object.keys(playgroundGlobs)) {
    const filename = basename(path);
    const name = filename.replace('.playground.ts', '');

    entries.push({
      id: name,
      category: 'playground',
      name,
      type: 'playground',
    });
  }

  for (const path of Object.keys(visualTestGlobs)) {
    const filename = basename(path);
    const name = filename.replace('.scene.ts', '');
    const id = deriveId(filename);
    const category = deriveCategory(path);

    entries.push({
      id,
      category,
      name,
      type: 'visual-test',
    });
  }

  for (const path of Object.keys(exampleGlobs)) {
    const filename = basename(path);

    let id: string;

    if (filename.endsWith('.example.ts')) {
      id = filename.replace('.example.ts', '');
    } else if (filename === 'index.ts') {
      id = path.split('/').at(-2)!;
    } else {
      id = filename.replace('.ts', '');
    }

    const underscoreIdx = id.indexOf('_');
    const category = underscoreIdx >= 0 ? id.slice(0, underscoreIdx) : 'example';
    const name = underscoreIdx >= 0 ? id.slice(underscoreIdx + 1) : id;

    entries.push({
      id,
      category,
      name,
      type: 'example',
    });
  }

  return entries;
}
