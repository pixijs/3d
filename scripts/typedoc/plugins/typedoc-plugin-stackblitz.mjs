import { copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import {
  bundledLanguages,
  bundledThemes,
  codeToTokensWithThemes,
  createOnigurumaEngine,
  createShikiInternal,
  loadBuiltinWasm,
} from '@gerrit0/mini-shiki';
import { PageEvent, RendererEvent } from 'typedoc';
import ts from 'typescript';

await loadBuiltinWasm();

const shiki = await createShikiInternal({
  engine: createOnigurumaEngine(),
  langs: [bundledLanguages.typescript, bundledLanguages.javascript],
  themes: [bundledThemes['github-light-default'], bundledThemes['github-dark-default']],
});

/** The repo root; the docs workspace runs typedoc with its cwd set to `scripts/typedoc` */
const ROOT = join(import.meta.dirname, '../../..');

/**
 * Where the preview iframe loads its libraries from, relative to the docs pages. The upload
 * workflow syncs `.s3_uploads/` as one tree, so the CDN files `npm run dist` stages there sit one
 * level above `docs/`. `pixi.js` is copied next to the pages when the HTML output finishes.
 */
const PREVIEW_IMPORTS = {
  'pixi.js': './pixi.min.mjs',
  '@pixi/3d': '../pixi-3d.min.mjs',
  '@pixi/3d/extras': '../pixi-3d-extras.min.mjs',
};
const PIXI_FILES = ['pixi.min.mjs', 'pixi.min.mjs.map'];

const EXAMPLE_EXTS = new Set(['.ts', '.js']);
const EXT_LANG = { '.ts': 'typescript', '.js': 'javascript' };

const DIRECTIVE_RE = /<p>\s*@stackblitz\(([a-zA-Z0-9_/-]+)\)[\s\S]*?<\/p>/g;

function addExample(examples, name, files) {
  if (examples.has(name)) {
    console.warn(`[stackblitz] Duplicate example name: "${name}"`);
  }
  examples.set(name, files);
}

function scanExampleDir(exDir, examples) {
  let entries;

  try {
    entries = readdirSync(exDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(exDir, entry.name);

    const ext = entry.name.substring(entry.name.lastIndexOf('.'));

    if (entry.isFile() && EXAMPLE_EXTS.has(ext)) {
      const name = entry.name.replace(/\.[^.]+$/, '');

      addExample(examples, name, new Map([[`index${ext}`, readFileSync(fullPath, 'utf-8')]]));
    } else if (entry.isDirectory()) {
      const files = new Map();

      readDirRecursive(fullPath, fullPath, files);

      if (files.size > 0) addExample(examples, entry.name, files);
    }
  }
}

/**
 * Adds the playground's single-file examples from the root `examples/`, named the way the
 * playground names them (`picking.example.ts` is `picking`). Its subfolders hold binary assets
 * and multi-file demos with no `index` entry, so they are skipped.
 * @param dir - the root `examples/` folder
 * @param examples - the example map to add to
 */
function scanRootExamples(dir, examples) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const match = entry.isFile() && entry.name.match(/^(.+)\.example(\.[jt]s)$/);

    if (!match) continue;

    addExample(examples, match[1], new Map([[`index${match[2]}`, readFileSync(join(dir, entry.name), 'utf-8')]]));
  }
}

function scanExamples() {
  const examples = new Map();
  const docsGlob = [];

  // Find all __docs__/examples/ directories under src/
  function findExampleDirs(dir) {
    let entries;

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const full = join(dir, entry.name);

      if (entry.name === 'examples') {
        const parent = basename(join(full, '..'));

        if (parent === '__docs__') {
          docsGlob.push(full);
        }
      } else {
        findExampleDirs(full);
      }
    }
  }

  findExampleDirs(join(ROOT, 'src'));

  for (const exDir of docsGlob) {
    scanExampleDir(exDir, examples);
  }

  scanRootExamples(join(ROOT, 'examples'), examples);

  return examples;
}

function readDirRecursive(base, dir, files) {
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isFile()) {
      const rel = relative(base, full);

      files.set(rel, readFileSync(full, 'utf-8'));
    } else if (entry.isDirectory()) {
      readDirRecursive(base, full, files);
    }
  }
}

/** The StackBlitz project's dependencies: `pixi.js` at the range `@pixi/3d` peers, and this version of `@pixi/3d` */
function getDependencies() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

  return {
    'pixi.js': pkg.peerDependencies['pixi.js'],
    '@pixi/3d': `^${pkg.version}`,
  };
}

function buildProjectData(name, files, dependencies) {
  const projectFiles = {};

  const entryFile = files.has('index.ts') ? 'index.ts' : 'index.js';

  // index.html that loads the example
  projectFiles['index.html'] = [
    '<!DOCTYPE html>',
    '<html><head>',
    '<style>html,body{margin:0;padding:0;overflow:hidden;width:100%;height:100%}</style>',
    '</head><body>',
    `<script type="module" src="./${entryFile}"></script>`,
    '</body></html>',
  ].join('\n');

  projectFiles['package.json'] = JSON.stringify(
    {
      name: `pixi-3d-example-${name}`,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite' },
      dependencies,
      devDependencies: {
        vite: '^7.0.0',
      },
    },
    null,
    2,
  );

  projectFiles['tsconfig.json'] = JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
      },
    },
    null,
    2,
  );

  for (const [filename, content] of files) {
    projectFiles[filename] = content;
  }

  const openFile = files.has('index.ts') ? 'index.ts' : files.has('index.js') ? 'index.js' : [...files.keys()][0];

  return {
    title: `PixiJS 3D Example: ${name}`,
    template: 'node',
    files: projectFiles,
    openFile,
  };
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeSrcdoc(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function transpileTs(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  return result.outputText;
}

function resolveImportToFile(importPath, files) {
  const stripped = importPath.replace(/^\.\//, '');

  if (files.has(stripped)) return stripped;

  for (const ext of ['.ts', '.js']) {
    if (files.has(stripped + ext)) return stripped + ext;
  }

  if (stripped.endsWith('.js')) {
    const tsPath = `${stripped.slice(0, -3)}.ts`;

    if (files.has(tsPath)) return tsPath;
  }

  for (const ext of ['.ts', '.js']) {
    if (files.has(`${stripped}/index${ext}`)) return `${stripped}/index${ext}`;
  }

  return null;
}

function toBareSpecifier(filename) {
  return `#${filename.replace(/\.[^.]+$/, '')}`;
}

function rewriteLocalImportsToBare(code, files) {
  return code.replace(
    /((?:import|export)\s+(?:.*?\s+from\s+)?['"])(\.\/[^'"]+)(['"])/gs,
    (match, prefix, importPath, suffix) => {
      const resolved = resolveImportToFile(importPath, files);

      if (resolved) {
        return `${prefix}${toBareSpecifier(resolved)}${suffix}`;
      }

      return match;
    },
  );
}

function buildPreviewSrcdoc(files) {
  const entryFile = files.has('index.ts') ? 'index.ts' : files.has('index.js') ? 'index.js' : null;

  if (!entryFile) return null;

  const imports = { ...PREVIEW_IMPORTS };

  // For multi-file examples, rewrite local imports to bare specifiers
  // and register each dependency as a data: URI in the import map.
  // Bare specifiers resolve globally via the import map regardless of
  // module origin, so no topological sort or per-file pixi.js rewriting needed.
  for (const [filename, content] of files) {
    if (filename === entryFile) continue;

    let code = filename.endsWith('.ts') ? transpileTs(content) : content;

    code = rewriteLocalImportsToBare(code, files);
    imports[toBareSpecifier(filename)] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  }

  let entryCode = files.get(entryFile);

  if (entryFile.endsWith('.ts')) {
    entryCode = transpileTs(entryCode);
  }

  entryCode = rewriteLocalImportsToBare(entryCode, files);
  entryCode = entryCode.replaceAll('</script', '<\\/script');

  const importMap = JSON.stringify({ imports });

  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="UTF-8">',
    '<style>html,body{margin:0;padding:0;overflow:hidden;width:100%;height:100%}canvas{display:block;}</style>',
    `<script type="importmap">${importMap}</script>`,
    '</head><body>',
    '<script type="module">',
    entryCode,
    '</script>',
    '</body></html>',
  ].join('');
}

function highlightCode(code, filename) {
  const ext = filename.substring(filename.lastIndexOf('.'));
  const lang = EXT_LANG[ext];

  if (!lang) return escapeHtml(code);

  const lines = codeToTokensWithThemes(shiki, code, {
    themes: { light: 'github-light-default', dark: 'github-dark-default' },
    lang,
  });

  return lines
    .map((line) =>
      line
        .map((token) => {
          const content = escapeHtml(token.content);
          const light = token.variants?.light?.color;
          const dark = token.variants?.dark?.color;

          if (!light && !dark) return content;

          return `<span style="--sl:${light};--sd:${dark}">${content}</span>`;
        })
        .join(''),
    )
    .join('\n');
}

function replaceDirectives(html, examples, dependencies) {
  return html.replace(DIRECTIVE_RE, (_match, name) => {
    const files = examples.get(name);

    if (!files) {
      console.warn(`[stackblitz] Unknown example: "${name}"`);

      return `<div class="stackblitz-embed stackblitz-error">Unknown example: <code>${name}</code></div>`;
    }

    const project = buildProjectData(name, files, dependencies);
    const json = JSON.stringify(project).replaceAll('</', '<\\/');
    const fileNames = [...files.keys()];
    const srcdoc = buildPreviewSrcdoc(files);
    const hasPreview = !!srcdoc;
    const toggleId = `sb-toggle-${name}`;

    const tabs = fileNames
      .map(
        (f, i) =>
          `<button class="stackblitz-tab${i === 0 ? ' active' : ''}" data-file="${escapeHtml(f)}">${escapeHtml(f)}</button>`,
      )
      .join('');

    const panels = fileNames
      .map(
        (f, i) =>
          `<pre class="stackblitz-panel${i === 0 ? ' active' : ''}" data-file="${escapeHtml(f)}"><code>${highlightCode(files.get(f), f)}</code></pre>`,
      )
      .join('');

    const lines = [
      `<div class="stackblitz-embed${hasPreview ? ' has-preview' : ''}" data-example="${escapeHtml(name)}">`,
      `<script type="application/json">${json}</script>`,
    ];

    if (hasPreview) {
      lines.push(
        `<input type="checkbox" id="${toggleId}" class="stackblitz-toggle-input" checked>`,
        '<div class="stackblitz-toolbar">',
        `<label for="${toggleId}" class="stackblitz-toggle-btn">`,
        '<span class="stackblitz-label-code">Show Code</span>',
        '<span class="stackblitz-label-preview">Show Preview</span>',
        '</label>',
        `<div class="stackblitz-tabs">${tabs}</div>`,
        '<button class="stackblitz-open-btn">▶ Open in StackBlitz</button>',
        '</div>',
        `<div class="stackblitz-preview"><iframe srcdoc="${escapeSrcdoc(srcdoc)}" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe></div>`,
        `<div class="stackblitz-code">${panels}</div>`,
      );
    } else {
      lines.push(
        '<div class="stackblitz-header">',
        `<div class="stackblitz-tabs">${tabs}</div>`,
        '<button class="stackblitz-open-btn">▶ Open in StackBlitz</button>',
        '</div>',
        `<div class="stackblitz-panels">${panels}</div>`,
      );
    }

    lines.push('</div>');

    return lines.join('\n');
  });
}

export function load(app) {
  let examples;
  let dependencies;

  app.renderer.on(RendererEvent.BEGIN, () => {
    examples = scanExamples();
    dependencies = getDependencies();

    console.log(`[stackblitz] Found ${examples.size} example(s)`);
  });

  app.renderer.on(PageEvent.END, (page) => {
    if (!page.contents) return;
    if (!page.contents.includes('@stackblitz(')) return;

    page.contents = replaceDirectives(page.contents, examples, dependencies);
  });

  app.renderer.on(RendererEvent.END, (event) => {
    if (!event.outputDirectory.endsWith('docs')) return;

    for (const file of PIXI_FILES) {
      copyFileSync(join(ROOT, 'node_modules/pixi.js/dist', file), join(event.outputDirectory, file));
    }
  });
}
