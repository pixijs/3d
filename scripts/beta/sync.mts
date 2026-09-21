import childProcess from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Mirrors this repo onto the closed-beta repo.
 *
 * The beta repo carries no upstream history: each sync wipes its tree, drops in
 * the source ref's tree, and lands one commit on top. Everything the beta repo
 * needs that this repo doesn't ship (its release workflow, the README banner)
 * lives in `scripts/beta/files` and is laid over the mirror.
 */

const BETA_REMOTE = 'https://github.com/pixijs-userland/pixi-3d-beta.git';

/** Paths dropped from the mirror: our CI, our hooks, and agent instructions. */
const EXCLUDE = ['.github', '.husky', '.claude', '.vscode', 'AGENTS.md', 'CLAUDE.md'];

const here = path.dirname(fileURLToPath(import.meta.url));
const overlay = path.join(here, 'files');

const run = (command: string, args: string[], cwd?: string): string =>
  childProcess.execFileSync(command, args, { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 512 }).trim();

const flag = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));

  return hit ? hit.slice(name.length + 3) : fallback;
};

function main(): void {
  const ref = flag('ref', 'main');
  const remote = flag('remote', BETA_REMOTE);
  const dryRun = process.argv.includes('--dry-run');
  const sha = run('git', ['rev-parse', ref]);
  const short = sha.slice(0, 7);
  const subject = run('git', ['log', '-1', '--format=%s', sha]);

  console.log(`Syncing ${ref} (${short} ${subject})`);

  const work = mkdtempSync(path.join(tmpdir(), 'pixi-3d-beta-'));

  try {
    run('git', ['clone', '--depth', '1', remote, work]);

    for (const entry of readdirSync(work)) {
      if (entry !== '.git') rmSync(path.join(work, entry), { recursive: true, force: true });
    }

    // `git archive | tar -x` gives us the ref's tree without touching the
    // working copy, so a sync is safe mid-edit and ignores untracked files.
    const archive = childProcess.execFileSync('git', ['archive', '--format=tar', sha], {
      maxBuffer: 1024 * 1024 * 512,
    });

    childProcess.execFileSync('tar', ['-x', '-C', work], { input: archive });

    for (const entry of EXCLUDE) rmSync(path.join(work, entry), { recursive: true, force: true });

    const banner = path.join(overlay, 'README-banner.md');
    const readme = path.join(work, 'README.md');

    if (existsSync(banner) && existsSync(readme)) {
      writeFileSync(readme, `${readFileSync(banner, 'utf-8').trim()}\n\n${readFileSync(readme, 'utf-8')}`);
    }

    cpSync(overlay, work, { recursive: true });
    rmSync(path.join(work, 'README-banner.md'), { force: true });

    run('git', ['add', '-A'], work);

    if (run('git', ['status', '--porcelain'], work) === '') {
      console.log('Beta repo already matches this ref; nothing to push.');

      return;
    }

    run('git', ['commit', '-m', `chore: sync pixi-3d@${short}`, '-m', subject], work);

    if (dryRun) {
      console.log(`Dry run: committed in ${work}, not pushed.`);
      console.log(run('git', ['show', '--stat', '--oneline', 'HEAD'], work));

      return;
    }

    run('git', ['push', 'origin', 'HEAD:main'], work);
    console.log(`Pushed pixi-3d@${short} to ${remote}. The Release workflow will draft a tarball release.`);
  } finally {
    if (!dryRun) rmSync(work, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
