# How to contribute

`@pixi/3d` grows through community changes, and these guidelines keep that process smooth for everyone involved.

## Reporting issues

Report bugs and request features in the [issue tracker][issues]. For questions, use [GitHub Discussions][discussions] or [Discord][discord].

1. **Search the existing issues first.** Your bug may already be reported or fixed.
2. **Link a minimal, runnable reproduction.** The bug template requires one, and an issue without it will be closed. The [reproduction guidelines](bug-repo-guidelines.md) explain what makes a good one.
3. **Share your environment.** Include the browser, OS, renderer (WebGL or WebGPU), library versions, and the steps to trigger the bug.

## Contributing changes

### Setting up

1. Install [Node.js][node] 24, the version CI uses.
2. Fork **[pixijs/3d][repo]** and clone your fork.
3. Run `npm install` in the clone.
4. Run `npx playwright install chromium`. The tests run in headless Chromium.

Remote models and textures download on the first test or playground run.

`npm run sync:repos` checks out the source of the libraries PixiJS 3D builds on into the gitignored `.repos/` folder, pixi.js at the commit your installed build came from, for reading while you work. `scripts/repos/manifest.mts` lists them. Once it exists, `npm install` moves it whenever the installed pixi.js changes.

`npm run setup` prepares a fresh clone or worktree in one step: a clean `npm ci` (which also installs the commit hooks), the asset mirror, and `.repos`. In a worktree, `.repos` copies from the main checkout without the network when it's at the same pin.

### Making a change

Branch off `main` in your fork, and read [`CODING_STANDARDS.md`](../CODING_STANDARDS.md) before you write code.

### Building your change

The npm scripts follow the same names as pixijs: `build:*` builds once, `watch:*` rebuilds on every change, and `test:*` checks.

- `npm start` serves the playground. It reads `src/` directly, so there's nothing to build first. Pass vite flags through, e.g. `npm start -- --host` to open it from a phone.
- `npm run build` builds the npm package (`build:lib`) and the CDN bundle (`build:cdn`) into `dist/`.
- `npm run build:docs` builds the API docs into `.s3_uploads/docs`, with a Markdown copy of each page beside its HTML. Any typedoc warning, such as a broken `{@link}`, fails it.
- `npm run watch:lib` rebuilds the package on every change.
- `npm run watch:docs` rebuilds the docs on every change and serves them on the first free port from 8080.
- `npm run dist` cleans, then builds everything the S3 upload needs into `.s3_uploads/`.
- `npm run clean` deletes `dist/`, `.pr_uploads/` and `.s3_uploads/`.

### Testing your change

If you fix a bug, add a test that fails without the fix. `npm test` runs these checks in order and stops at the first failure:

- `npm run test:lint`: the oxlint and oxfmt check, plus a check that the generated barrels are current. `npm run lint` fixes what it can.
- `npm run test:types`: tsc over `src/`, the worker scripts, `playground/`, `examples/` and `bench/`.
- `npm run test:docs`: type-checks the code examples in the JSDoc, the guides, the tutorial steps and `README.md`, and checks that every path, code name, link and `{@link}` in the Markdown docs still leads somewhere.
- `npm run test:unused`: reports `@internal` declarations that nothing outside tests and benchmarks uses.
- The Vitest suite in headless Chromium. `npm run test:unit` and `npm run test:visual` run its unit and visual halves on their own, and `npm run watch:test` runs it in watch mode.

CI then runs `npm run build`, `npm run test:bundle` and `npm run test:dts`. Run them yourself when you change the build or the package's exports. CI also runs `npm run build:docs`; run it yourself after you change JSDoc or a guide.

[`tests/README.md`](../tests/README.md) covers writing a visual scene, running a single test, updating reference images and adding a remote asset. To show a change is faster, see [`bench/README.md`](../bench/README.md).

### Submitting your change

Push your branch to your fork and open a pull request against `main` on [pixijs/3d][repo]. Commit messages and the PR title must start with `feat:`, `fix:`, `chore:`, `breaking:` or `perf:`; CI checks the title. A PR stacked on another open PR, which must be reviewed before the parent merges, starts with `fixup(#<parent PR>):` instead. Make sure `npm test` passes first.

## Contributor Code of Conduct

[Code of Conduct](CODE_OF_CONDUCT.md) is adapted from [Contributor Covenant, version 1.4](http://contributor-covenant.org/version/1/4).

[issues]: https://github.com/pixijs/3d/issues
[discussions]: https://github.com/pixijs/3d/discussions
[discord]: https://discord.gg/CPTjeb28nH
[node]: https://nodejs.org
[repo]: https://github.com/pixijs/3d
