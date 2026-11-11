/**
 * Mirrors every remote asset in the `examples/assets/manifest.ts` categories
 * into a local store, where every environment serves it at the path the
 * manifest's accessors produce. The main file of each entry is renamed to the
 * entry name; `.gltf` models also pull their sidecar buffers and images, which
 * keep their original relative paths inside the entry's folder.
 * Already-present files are skipped, so a warm mirror makes this a fast no-op.
 *
 * The store defaults to `~/.pixijs/mirror`, shared by every clone and worktree,
 * with `examples/assets/mirror` symlinked to it (an existing real directory is
 * adopted into the store first). `PIXI_MIRROR_DIR` overrides the store
 * location; `--local` skips the shared store and keeps a real repo-local
 * directory instead.
 *
 * Runs from a vitest/playground plugin on every dev-server start, or directly:
 * `npm run download:assets`.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assetEntries,
  environments,
  MIRROR_ROUTE,
  models,
  sounds,
  textures,
  videos,
} from '../../examples/assets/manifest.ts';
import type { AssetCategory, AssetEntry } from '../../examples/assets/manifest.ts';

/** Every manifest category to mirror; new categories join this list. */
const categories: AssetCategory[] = [models, environments, textures, sounds, videos];

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** The path every environment serves at `/mirror/`; a symlink to the store unless `--local`. */
const MIRROR_PATH = path.join(REPO_ROOT, 'examples/assets/mirror');

const CONCURRENCY = 8;
const RETRIES = 3;

/** One file to mirror: its remote source and its destination on disk. */
interface MirrorItem {
  url: string;
  file: string;
}

/**
 * Where downloads land: the env override, the repo dir (`--local`), or the shared store.
 * @param local - Whether `--local` was passed
 */
function resolveStore(local: boolean): string {
  if (local) {
    return MIRROR_PATH;
  }
  const override = process.env.PIXI_MIRROR_DIR;

  return override ? path.resolve(REPO_ROOT, override) : path.join(os.homedir(), '.pixijs/mirror');
}

/**
 * Disk location of a served mirror path inside the store.
 * @param store - The store root
 * @param served - A served mirror path, starting with the mirror route
 */
function diskPath(store: string, served: string): string {
  return path.join(store, ...served.slice(MIRROR_ROUTE.length).split('/'));
}

async function exists(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => null);

  return stat !== null && stat.size > 0;
}

/**
 * Moves one file into the store, tolerating cross-device links and files the store already has.
 * @param source - File to move
 * @param dest - Destination inside the store
 */
async function moveIntoStore(source: string, dest: string): Promise<void> {
  if (await exists(dest)) {
    await fs.unlink(source);

    return;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(source, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error;
    }
    await fs.copyFile(source, dest);
    await fs.unlink(source);
  }
}

/**
 * Recursively moves every file under `dir` into the store, preserving relative paths.
 * @param dir - Directory to move into the store
 * @param store - The store root
 * @param relative - Path of `dir` relative to the directory being adopted
 */
async function adoptDirectory(dir: string, store: string, relative = ''): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const source = path.join(dir, entry.name);
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await adoptDirectory(source, store, rel);
    } else if (entry.isFile()) {
      await moveIntoStore(source, path.join(store, ...rel.split('/')));
    }
  }
}

/**
 * Makes `examples/assets/mirror` a symlink to the store: an existing real
 * directory (a pre-store checkout, or a CI cache restored locally) is adopted
 * into the store first, and a symlink to a different location is repointed.
 * @param store - The store root the symlink points at
 */
async function ensureStoreLink(store: string): Promise<void> {
  await fs.mkdir(store, { recursive: true });
  const stat = await fs.lstat(MIRROR_PATH).catch(() => null);
  if (stat?.isSymbolicLink()) {
    if (path.resolve(path.dirname(MIRROR_PATH), await fs.readlink(MIRROR_PATH)) === store) {
      return;
    }
    await fs.unlink(MIRROR_PATH);
  } else if (stat?.isDirectory()) {
    await adoptDirectory(MIRROR_PATH, store);
    await fs.rm(MIRROR_PATH, { recursive: true });
  } else if (stat) {
    throw new Error(`${MIRROR_PATH} exists but is neither a directory nor a symlink`);
  }
  // A junction needs no admin rights or Developer Mode on Windows; other platforms ignore the type.
  await fs.symlink(store, MIRROR_PATH, 'junction');
}

/** In `--local` mode the mirror is a real repo-local directory, never a symlink. */
async function ensureLocalDir(): Promise<void> {
  const stat = await fs.lstat(MIRROR_PATH).catch(() => null);
  if (stat?.isSymbolicLink()) {
    await fs.unlink(MIRROR_PATH);
  }
  await fs.mkdir(MIRROR_PATH, { recursive: true });
}

let tmpCounter = 0;

async function fetchToDisk(url: string, file: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const data = Buffer.from(await response.arrayBuffer());
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Write to a unique temp name, then rename: an aborted run never leaves a
      // truncated file behind to poison the skip-existing check or the CI cache.
      const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, file);

      return;
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Relative URIs of a `.gltf`'s external buffers and images, as authored in the file.
 * @param file - Path to the `.gltf` on disk
 */
async function sidecarUris(file: string): Promise<string[]> {
  type ExternalRef = { uri?: string };
  const gltf = JSON.parse(await fs.readFile(file, 'utf8')) as {
    buffers?: ExternalRef[] | Record<string, ExternalRef>;
    images?: ExternalRef[] | Record<string, ExternalRef>;
    shaders?: Record<string, ExternalRef>;
  };
  // glTF 2.0 keeps buffers/images in arrays; the 1.x tutorial models use id-keyed objects.
  const refs = (group?: ExternalRef[] | Record<string, ExternalRef>): ExternalRef[] =>
    Array.isArray(group) ? group : Object.values(group ?? {});

  return [...refs(gltf.buffers), ...refs(gltf.images), ...refs(gltf.shaders)]
    .map((item) => item.uri)
    .filter((uri): uri is string => !!uri && !uri.startsWith('data:') && !uri.startsWith('http'));
}

async function mirrorAll(store: string, entries: AssetEntry[]): Promise<{ downloaded: number; skipped: number }> {
  const queue: MirrorItem[] = entries.map((entry) => ({ url: entry.url, file: diskPath(store, entry.path) }));
  const seen = new Set(queue.map((item) => item.file));
  let downloaded = 0;
  let skipped = 0;

  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      if (await exists(item.file)) {
        skipped++;
      } else {
        await fetchToDisk(item.url, item.file);
        downloaded++;
      }
      // A cached .gltf may still be missing sidecars (partial CI cache), so
      // always parse and enqueue them; skip-existing keeps that cheap. Sidecars
      // keep their authored relative paths next to the (renamed) main file.
      if (item.url.endsWith('.gltf')) {
        const dir = path.dirname(item.file);
        for (const uri of await sidecarUris(item.file)) {
          const file = path.join(dir, ...uri.split('/').map(decodeURIComponent));
          if (!seen.has(file)) {
            seen.add(file);
            queue.push({ url: new URL(uri, item.url).href, file });
          }
        }
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return { downloaded, skipped };
}

let inflight: Promise<void> | undefined;

/**
 * Mirrors every asset the manifest references; concurrent calls share one run.
 * @param options - Download options
 * @param options.local - Keep a real repo-local mirror instead of linking the shared store
 */
export function downloadAssets(options: { local?: boolean } = {}): Promise<void> {
  inflight ??= (async () => {
    const store = resolveStore(options.local ?? false);
    await (options.local ? ensureLocalDir() : ensureStoreLink(store));
    const { downloaded, skipped } = await mirrorAll(store, categories.flatMap(assetEntries));
    if (downloaded > 0) {
      console.log(`asset mirror: downloaded ${downloaded} file(s), ${skipped} already mirrored`);
    }
  })();

  return inflight;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  downloadAssets({ local: process.argv.includes('--local') }).catch((error) => {
    console.error('asset download failed:', error);
    process.exitCode = 1;
  });
}
