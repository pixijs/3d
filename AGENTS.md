This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.

Talk like a colleague at a whiteboard: plain words, short active sentences, one idea at a time, no filler or stacked hedges. Rewrite any sentence that needs three internal names to parse. Use the codebase's and pixi's names, and spell out anything else literally rather than coining shorthand or a metaphor.

Read before you:

- plan, write or review code: `CODING_STANDARDS.md`
- change, review, debug or explain rendering or per-frame code: `docs/architecture.md`
- write, run or debug tests: `tests/README.md`
- measure performance: `bench/README.md`
- show what a change does, or build or screenshot a playground scene: `playground/README.md`
- write or change an example: `examples/README.md`
- write or change a guide in `src/**/__docs__` or `examples/tutorials/`: `src/__docs__/README.md`
- change public API names, options or defaults, or edit the agent skill in `skills/`: `docs/skills.md`
- commit or open a PR: `.github/CONTRIBUTING.md`

While iterating, run the narrowest check: `npm run test:types` or one test file. `npm test` runs every CI check that doesn't need a build.

Search with `rg` or `git grep`; they skip gitignored folders such as `node_modules`, `dist` and `.repos`.

For how pixi works inside, read its source in `.repos/pixijs`, searched by path. Run `npm run sync:repos` first; it's a no-op when current.
