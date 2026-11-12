# Lint rules, examples and tiers

Reference for `SKILL.md`: what the doc rules allow, so you needn't read `scripts/lint/`, and how to handle a `@standard` member's example and tier.

## What the rules allow

- **`pixijs-3d/no-comments`** covers all of `src` and the scenes and tests in `tests/`. Outside test files it allows JSDoc blocks sitting directly on a declaration; everywhere it allows tool directives: lint, TypeScript and formatter suppressions, coverage hints, bundler annotations, license headers, the `/* wgsl */` and `/* glsl */` tags, and generated-file headers. `isDirective` in `scripts/lint/ast.ts` has the list. When the rule flags a comment that instructs a tool, extend `isDirective` and tell the user.
- **The doc rules** (`require-export-jsdoc`, `require-member-api-doc`, `require-standard-example`, `jsdoc-style`) skip test files, private and protected members, names starting with `_` or `#`, constructors, and anything whose own doc or an enclosing declaration's doc says `@hidden`, `@internal`, `@ignore` or `@private`.
- **Every export** carries exactly one of `@category`, `@internal`, `@ignore` or `@private`. **Every public member** has its own JSDoc and a tier, `@standard` or `@advanced`, on itself or inherited from its class or interface.
- **`@example`** is required on `@standard` API, except constructors and `@deprecated` members. A get/set pair needs one example, on either half.
- **A JSDoc that fits on one line** is written `/** ... */`; `pixijs-3d/jsdoc-format` reports one spread over several lines, and `--fix` collapses it.

## Examples

An example shows typical use in a few lines, as correct use of the public API: public names only (never `_onUpdate`), and scratch objects of its own rather than a node's position or rotation. `node scripts/typedoc/check-examples.mts <file|dir>` type-checks one file or folder; its header says how free names resolve.

## Tiers

The tier is the user's call; raise a change only when typical users don't need the member. When the only example you can think of is contrived, keep the tier and put the opt-out between the JSDoc and the declaration, with a reason after `--`:

```ts
/** Always `'spot'` */
// oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only discriminant
public readonly type = 'spot';
```

Lint reports a directive that no longer suppresses anything, so remove it when you add an example later.

The user's rulings so far:

- **Stays `@standard`:** read-only state and discriminants (`type`, `destroyed`, `topology`); every public event and its `on*` handler, even one that rarely fires; interfaces users implement or receive, such as a custom hit volume and its result; methods a class shares with a sibling (`ObservableVector3` with `Vector3`), including `clone`.
- **Went to `@advanced`:** raw-buffer plumbing (`Matrix4.elements64`, `multiplyAffine`, `Frustum.planesData`); subclass and render-graph hooks (the effects' `build`, `getPrimaryDescriptor`, custom-material options); overrides that only fix a value (`FlatMaterial.lit`); debug helpers (`toString`).

A `?: never` member that only keeps two option shapes apart (such as `bounds` and `cascades` on the light shadow options) gets `@hidden` instead of an example, and keeps its one-line description, which editors still show on hover.
