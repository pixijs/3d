# Skills

Skills are how coding agents (Claude Code, Codex and others) learn to use `@pixi/3d` well. Each folder in `skills/` is one skill: a `SKILL.md` the agent reads when it decides the skill is relevant, plus references/ with one complete recipe per job. `skills/` ships inside the npm package (`files` in `package.json`) the same way `pixi.js` ships its skills, so a project that installs `@pixi/3d` has the skill at `node_modules/@pixi/3d/skills/pixijs-3d`. Keep only skill folders in `skills/`; notes for maintainers, like this page, live in `docs/`.

## Why they are shaped like this

Measured with [creation-evals](https://github.com/pixijs/creation-evals), which gives the same tasks to agents with different 3D libraries and compares cost, time and quality:

- Agents using Three.js write from memory in about 3 tool steps. Agents using `@pixi/3d` took 10 to 12, six of them documentation lookups before the first line of code. That step count was the whole cost gap; page size and findability were not.
- Reference-style documentation (name mappings, a slimmed API reference, an "API at a glance" page) did not change that, even when agents were guaranteed to read it.
- The `pixijs-3d` skill did: cost per working result fell from $0.23 to $0.14 and steps from 11.6 to 6.5, with quality unchanged, because agents open one recipe and adapt it instead of assembling code from signatures.

So: lead with complete, runnable code. Describe only what the code does not show.

## Writing a skill

1. `SKILL.md` starts with YAML front matter. The `description` is the only thing the agent sees before deciding to open the skill, so it must name the library, the classes and the jobs it covers, in the words agents search for (including names from Three.js and the older `pixi3d` package where relevant).
2. Then a Quick Start: one complete src/main.ts for a Vite + TypeScript app, 40 to 90 lines, no placeholders.
3. Then conventions and pitfalls as short bullets, and a table of which reference covers which job.
4. Each file in references/ has the same shape: one complete program, then a few focused variations.
5. Put what every reader of a file needs in its first 150 lines. Agents often read a reference with `head -200`, so a rule after a long code block is missed: in the Three.js porting reference the hemisphere rule sat at line 229 and two of six port trials got it wrong until it moved to the top. Silent pitfalls also go in `SKILL.md`, which every agent reads.

## When the API changes

The skill ships with every release, so a renamed option, a changed default or a new pitfall in `src/` makes it wrong for every user. In the same PR, search the skill and the guides for the names you changed (`rg -n <name> skills src/__docs__ src/*/__docs__`), update every file that mentions them, and run the snippet check below. [Porting from Three.js](../src/__docs__/getting-started/porting-from-threejs.md) repeats the skill's Three.js differences in short, so a change to one belongs in both. Behaviour changes that run without errors but change the picture (defaults, colour space, units) belong in the "Pitfalls that fail silently" list in `SKILL.md`.

## Keeping snippets true

Every complete program must compile against the current build. creation-evals has a one-line checker:

```sh
bash scripts/typecheck-snippet.sh path/to/snippet.mts   # in the creation-evals checkout
```

It type-checks a standalone file against the installed `@pixi/3d` snapshot and exits non-zero on any error. Run it on every Quick Start and every standalone section snippet before committing. A snippet that does not compile makes agents slower than no snippet at all.

## Measuring a change

From a creation-evals checkout, with this repo at the commit to measure:

```sh
npm run pack:pixi3d                 # snapshots this repo, including every skills/*/SKILL.md
npm run run -- --suite quick        # 15 capability probes, Claude Code, 3 trials each (about 25 minutes)
npm run compare -- jobs/<new> jobs/<previous> --html
npm run friction -- jobs/<new>      # which references agents opened, where they still browsed
```

`npm run pack:pixi3d -- --no-skills` measures the same commit without skills, for an A/B. Run `--suite heldout` occasionally; those tasks are never used while iterating, so they show whether the skills generalise.

Two faster and more targeted measures:

```sh
npm run check-snippets -- --library pixi3d --dir <this repo>/skills/pixijs-3d   # every code block type-checks; 0 api errors is the bar
npm run probe -- --library pixi3d --skills candidate=<this repo>/skills/pixijs-3d --out knowledge/pixi3d/runs/<name>
npm run run -- --suite pixi3d-port   # port a working Three.js app; scored on behaviour and on pixels matching the Three.js render
```

The probe asks 128 short questions written from source (92 for iterating, 36 held out) and scores answers by type-check, a runtime check in Chromium and a model judge. Measured on 2026-11-10 against main:

|                                                | no skill           | previous skill | this skill      |
| ---------------------------------------------- | ------------------ | -------------- | --------------- |
| knowledge probe, all / held out                | 11% / 14%          | 76% / 74%      | 92% / 79–82%    |
| app tasks iterated on (pass, cost per success) | 96%, $0.27         | 93%, $0.14     | 91%, $0.15      |
| held-out app tasks                             | 89%, $0.45         | 78%, $0.24     | 89%, $0.21      |
| porting a Three.js app                         | 76–86%, $0.35–0.41 | 52%, $0.27     | 81%, $0.19–0.21 |

Without a skill the model writes no working `@pixi/3d` code at all (0 of 134 code answers): the library is newer than its training data.
