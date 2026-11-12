# Coding standards

How code in `@pixi/3d` is written. Authors read it before writing code; reviewers check a diff against it. A line marked _(lint)_ or with a script name is checked by tooling, so it's here to get the code right the first time and a reviewer can skip it. Everything else is for the author and the reviewer to hold.

## Classes and files

- Each class gets its own file beside the files of its kind, `@internal` helper classes included. _(lint)_
- Every class member has an explicit `public`, `protected`, or `private`, except constructors. Private members are named `_camelCase`, and members that are never reassigned are `readonly`. _(lint)_
- Class fields typed `number` get an initializer even when the constructor assigns the real value: `public count = 0;`, or `public readonly count: number = 0;` so TypeScript doesn't infer the literal type `0`. _(lint)_
- Casts name a precise type rather than `any`. _(lint)_
- A cast or non-null `!` that doesn't change the type is left out. _(lint)_

## Imports and exports

- Files in `src` import each other by relative path. Test and scene files import source through `~/` and test helpers from `@test-utils`. _(lint, test side)_
- Backend code stays in its folder: shared code imports `core/gl` and `core/gpu` with `import type` only, the two backends never import each other, and only `src/extras` imports `extras`. _(lint)_
- A page that imports the built package loads neither backend upfront unless it also imports `@pixi/3d/webgl` or `@pixi/3d/webgpu`. The package's declarations type-check on TypeScript 5, 6 and 7. `npm test` checks neither, so after a change to the build or the package's exports, run `npm run build`, then `npm run test:bundle` and `npm run test:dts`.
- Export an `@internal` declaration only when another file (tests included) imports it, or when a type that other files use names it. Being a parameter or return type doesn't count. _(`npm run test:unused`)_
- Every `@internal` declaration needs a use outside tests and benchmarks. _(`npm run test:unused`)_
- Public API shows users only public types. A type that a public member takes, returns, extends or exposes is public too, with its own docs; when users have no use for the type, hide the member instead. _(`npm run test:unused`)_
- `examples/` and `playground/` use only the public API: examples are the code users copy, and a playground scene shows a maintainer a change the way users will meet it. Where no public API does the job yet, the use carries an `unused-internal-disable` comment naming the gap. _(`npm run test:unused`)_
- Warnings from `src` go through `warn` from `pixi.js`. `console` is for `examples/` and `scripts/`. _(lint)_
- `src` calls no deprecated API, pixi's included. A call that has to stay carries a disable comment saying why. _(lint)_

## Changing an API

- `@pixi/3d` isn't released yet, so an API change replaces the old shape outright, with no deprecated alias or compatibility shim left behind.
- The same change updates every use of the old shape in `docs/`, the guides, the READMEs, `examples/` and `playground/`.

## Misuse

- Code makes the intended use work and trusts the caller, as pixi does. Misuse, such as drawing a destroyed geometry, gets no named error, validation check or recovery path. A fix for a report that mixes the two fixes only the intended use.

## Tests

- Know what a test protects before you write it: name the behaviour, a credible mistake that would turn the test red, and an expected result you can justify without reading the implementation.
- A test pins behaviour a user sees. It protects the contract, not incidental structure, so it stays green when the internals are rewritten and the public behaviour stays the same. Expected values and mocks state the intended result rather than recomputing it with the code under test.
- Rendering gets a visual scene (`tests/README.md`), and the rest goes through the public API: thrown errors, public math, events, draw counts. A test reaches into `@internal` code only for what the public API can't show: a release under "Resource lifetime", or a cost such as an upload count or a skipped rebuild.
- A test is small, fast and pointed, so its failure names the broken behaviour. An interaction an isolated test can't set up gets an integration test or a visual scene.
- Scaffolding is temporary: a test that helped sketch an API or build a feature is deleted once it stops protecting a contract.
- A red test is a bug report: fix the code, or the expectation if it was wrong. Never delete or weaken a failing test just to make the suite pass.

## Comments and JSDoc

JSDoc is written for people using the library. Every line is something a later change has to keep true, so write the least that does the job.

- Comments in `src` are JSDoc blocks on declarations plus tool directives: lint and TypeScript suppressions, formatter ignores, and the `/* wgsl */` and `/* glsl */` tags on shader strings. An explanation that would be a comment goes into a name, a type, or a test. _(lint)_
- Public JSDoc, on `@standard` and `@advanced` API, passes the _user test_: would someone who has never read the source write different code knowing this? It says what the thing does, when to use it, and the gotchas: the default, the units or space, a limit or cost they'll notice, a common mistake. Where the engine's internals change what the user sees, it describes the effect ("culls on the CPU in WebGL") rather than the mechanism.
- Public JSDoc is a one-line summary plus at most three sentences on a member, a few short paragraphs on a class, and one bullet per value of an option. The name and the type speak for themselves. Each fact lives on the declaration that owns it; elsewhere, `{@link}` to it.
- Internal JSDoc, on `@internal` declarations, private members, members of `@internal` types and non-exported code, holds only _guards_: what a maintainer would break something without and can't see in the code. Each guard is one line, two at most. A block with no guard goes, or becomes `/** @internal */` alone where lint requires a block. A guard is one of:
  - a rule shared with another file, with a line at each end naming the other
  - a workaround for a browser or driver bug
  - a shape kept for speed
  - a line that looks removable but isn't, such as an early return, a call order or a pool
  - what a sentinel such as `-1` or `null` means, an argument edited in place, or a value's units or space when its name and type don't say
- Protected members follow their class: public rules on a class users subclass, internal rules otherwise.
- Public functions and methods give every parameter a `@param` line; internal code needs none. _(lint)_
- Tests explain themselves through the `it` or `describe` title, an expect message, a name, or a skipped scene's `skipReason`, and carry tool directives only. _(lint)_
- JSDoc describes the code as it stands. The story of how it got there (the bug being fixed, alternatives considered, assumptions that turned out wrong) goes in the PR description.
- JSDoc prose punctuates with commas, semicolons, colons and full stops, never em or en dashes, and writes a range as "0 to 1". _(lint)_
- Public `@standard` API carries an `@example`, including members that inherit the tier from their class or interface. _(lint)_
- The tier says who the API is for, not whether it has an example. A `@standard` member with no useful example stays `@standard` and opts out of the lint rule with a reason. Move a member to `@advanced` only when typical users don't need it.
- Examples are type-checked against the source. Context an example assumes (`app`, `view3d`, `model`) is typed `any`, and a stand-in user class is named `My…`. _(`npm run test:docs`; the script's header covers the rest)_

## Shader math

- In shader code (the shader plugins and ShaderBits under `src/core`), the shape of the math is the optimisation. Branch-free `select` arithmetic is there because branches stall Apple GPUs. Keep that shape even where a branch would read better, and change it only when a benchmark backs the change (`bench/README.md`).
- Names declared in shader source are legal in both languages: no WGSL or GLSL ES 3.00 keyword or reserved word (`target`, `filter`, `meta`, `half`, `input`), and no `gl_` or `__` prefix. A reserved name fails the compile, and on WebGPU the failed pipeline can take the tab down. _(lint)_

## Runtime cost

- Runtime cost wins over ergonomics, on mobile as well as desktop. Favour low allocation counts, minimal draw calls, tight GPU state, and small shader and uniform footprints.
- Per-frame code doesn't allocate. It reuses module-level scratch objects and option objects refilled per call, binds closures once, stamps ticks in place of building Sets, and keeps lists in typed arrays.
- A change counter that tracks content or shape changing ends in DirtyId, such as `_visibilityDirtyId`; one that tracks a resource's identity changing ends in Version, such as `bufferVersion`. Its watermark is `last` plus the counter's name, and moves only where the work it guards ran: one claimed on a path that skipped the work leaves a stale cache in use until something unrelated bumps the counter.
- Code whose JSDoc says its shape is deliberate keeps that shape. A change that merges or abstracts it brings a benchmark that shows the cost.
- A change that adds work to a per-frame path brings a `benchy` result (`bench/README.md`).

## Resource lifetime: destroy and unload

- Whatever you create (resource, listener, store row, cache entry, back-reference) ships with its release in the same change: in the owner's `destroy()`, and in `unload()` too if it holds GPU memory.
- `destroy()` is permanent. `unload()` frees GPU memory and recorded artifacts, keeps CPU data, and the next render rebuilds. Both are idempotent.
- What WebGL frees, WebGPU frees too. A re-created resource invalidates every draw list, bundle, or bind group that baked the old one.
- After `destroy()`, nothing references the dead object: no list, hash, Map, or GC hash entry.
- `destroy()` releases a `readonly` field by nulling the field itself and keeping the `readonly`: `(this.field as FieldType | null) = null`, pixi's pattern adjusted for strict null checks. _(lint)_
- Every new resource ships with a test that its release happened and, for `unload()`, that the next render rebuilds it. `src/core/__tests__/rendererGc.test.ts` is the recipe.
