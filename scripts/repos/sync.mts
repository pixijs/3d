/**
 * Checks out the read-only reference repositories in `scripts/repos/manifest.mts` into `.repos/`, so
 * agents and contributors can read the source of the libraries PixiJS 3D builds on rather than their
 * compiled output: `npm run sync:repos [name...]`.
 *
 * Each repository is a depth-1 checkout of one commit. An entry that follows an npm package checks out
 * the commit its installed version was built from: npm's `gitHead` for a dev build such as
 * `8.22.0-dev.194e42c`, falling back to the `v<version>` tag. Running it again moves each checkout to its
 * current pin, skips the network for an npm pin that hasn't changed, and deletes folders the manifest no
 * longer lists. In a worktree, a repository the main checkout already has at the same pin is copied from
 * there, with no network. `.repos` is gitignored, so lint, formatting and repo-wide searches skip it.
 *
 * `npm install` runs it with `--existing`, which moves only checkouts that already exist and warns
 * rather than fails, so `.repos` follows a pixi.js upgrade without making a fresh clone or CI clone it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { referenceRepos } from './manifest.mts';
import type { ReferenceRepo } from './manifest.mts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const REPOS_DIR = path.join(REPO_ROOT, '.repos');
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Runs git and returns its trimmed output
 * @param args - The git arguments
 * @param cwd - Directory to run in
 */
function git(args: string[], cwd = REPO_ROOT): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Runs git and returns its trimmed output, or null when it fails
 * @param args - The git arguments
 * @param cwd - Directory to run in
 */
function gitOrNull(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

/**
 * The commit a branch or tag points at on the remote, peeling annotated tags, or the ref itself when it's a
 * full sha. A branch wins over a tag of the same name, as with `git clone --branch`.
 * @param repository - Git URL
 * @param ref - Branch, tag or full sha
 */
function remoteSha(repository: string, ref: string): string {
  if (FULL_SHA.test(ref)) return ref;
  const rows = git(['ls-remote', repository, `refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  const pick = (suffix: string): string | undefined => rows.find(([, name]) => name.endsWith(suffix))?.[0];
  const sha = pick(`refs/heads/${ref}`) ?? pick('^{}') ?? rows[0]?.[0];
  if (!sha) throw new Error(`${ref} doesn't exist on ${repository}`);
  return sha;
}

/**
 * The installed version of an npm package
 * @param name - Package name
 */
function installedVersion(name: string): string {
  const file = path.join(REPO_ROOT, 'node_modules', name, 'package.json');
  if (!fs.existsSync(file)) throw new Error(`${name} isn't installed; run npm install first`);
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version;
}

/**
 * The commit an npm package version was published from: npm's `gitHead`, or the `v<version>` tag
 * @param name - Package name
 * @param version - Installed version
 * @param repository - Git URL of the package's source
 */
function publishedSha(name: string, version: string, repository: string): string {
  const gitHead = execFileSync('npm', ['view', `${name}@${version}`, 'gitHead'], { encoding: 'utf8' }).trim();
  return FULL_SHA.test(gitHead) ? gitHead : remoteSha(repository, `v${version}`);
}

/** The main checkout's `.repos` when this checkout is a linked worktree, otherwise null */
function mainCheckoutReposDir(): string | null {
  const commonDir = gitOrNull(['rev-parse', '--path-format=absolute', '--git-common-dir'], REPO_ROOT);
  if (!commonDir) return null;
  const mainRoot = fs.realpathSync(path.dirname(commonDir));
  return mainRoot === fs.realpathSync(REPO_ROOT) ? null : path.join(mainRoot, '.repos');
}

const MAIN_REPOS_DIR = mainCheckoutReposDir();

/**
 * Moves one repository's checkout to its pinned commit, cloning it when it's missing
 * @param entry - The manifest entry
 * @returns What happened, for the summary line
 */
function sync(entry: ReferenceRepo): string {
  const dir = path.join(REPOS_DIR, entry.name);
  const npmPin = typeof entry.ref === 'string' ? null : entry.ref.npm;
  const version = npmPin ? installedVersion(npmPin) : null;
  const head = fs.existsSync(path.join(dir, '.git')) ? gitOrNull(['rev-parse', 'HEAD'], dir) : null;

  const pin = npmPin ? `${npmPin}@${version}` : (entry.ref as string);

  if (head && npmPin && gitOrNull(['config', 'pixijs-3d.pin'], dir) === pin) {
    return `up to date at ${pin} (${head.slice(0, 7)})`;
  }

  const mainClone = MAIN_REPOS_DIR ? path.join(MAIN_REPOS_DIR, entry.name) : null;
  const mainHead = mainClone ? gitOrNull(['rev-parse', 'HEAD'], mainClone) : null;
  const mainHasPin = npmPin !== null && mainHead !== null && gitOrNull(['config', 'pixijs-3d.pin'], mainClone!) === pin;
  const sha = mainHasPin
    ? mainHead
    : npmPin
      ? publishedSha(npmPin, version!, entry.repository)
      : remoteSha(entry.repository, entry.ref as string);

  if (!head) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    git(['init', '--quiet'], dir);
    git(['remote', 'add', 'origin', entry.repository], dir);
  } else {
    git(['remote', 'set-url', 'origin', entry.repository], dir);
  }

  if (head !== sha) {
    const source = mainHead === sha ? pathToFileURL(mainClone!).href : 'origin';
    git(['fetch', '--quiet', '--depth', '1', source, sha], dir);
    git(['checkout', '--quiet', '--force', '--detach', 'FETCH_HEAD'], dir);
    git(['clean', '-fdxq'], dir);
  }
  git(['config', 'pixijs-3d.pin', pin], dir);

  if (head === sha) return `up to date at ${pin} (${sha.slice(0, 7)})`;
  return `${head ? `moved ${head.slice(0, 7)} ->` : 'cloned'} ${pin} (${sha.slice(0, 7)})`;
}

const existingOnly = process.argv.includes('--existing');
const names = process.argv.slice(2).filter((arg) => arg !== '--existing');
const unknown = names.filter((name) => !referenceRepos.some((entry) => entry.name === name));
if (unknown.length) {
  console.error(`Not in scripts/repos/manifest.mts: ${unknown.join(', ')}`);
  process.exit(1);
}

if (existingOnly && !fs.existsSync(REPOS_DIR)) process.exit(0);
fs.mkdirSync(REPOS_DIR, { recursive: true });
let failed = 0;

for (const entry of referenceRepos) {
  if (names.length && !names.includes(entry.name)) continue;
  if (existingOnly && !fs.existsSync(path.join(REPOS_DIR, entry.name, '.git'))) continue;
  try {
    console.log(`.repos/${entry.name}: ${sync(entry)}`);
  } catch (error) {
    failed++;
    console.error(`.repos/${entry.name}: failed, ${(error as Error).message.split('\n')[0]}`);
  }
}

if (!names.length && !existingOnly) {
  for (const folder of fs.readdirSync(REPOS_DIR)) {
    if (folder.startsWith('.') || referenceRepos.some((entry) => entry.name === folder)) continue;
    fs.rmSync(path.join(REPOS_DIR, folder), { recursive: true, force: true });
    console.log(`.repos/${folder}: deleted, no longer in the manifest`);
  }
}

if (failed && existingOnly) console.warn('Run `npm run sync:repos` to retry.');
process.exitCode = failed && !existingOnly ? 1 : 0;
