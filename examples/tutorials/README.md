# Tutorials

These are the step-by-step tutorials that pixijs.com publishes under `/3d/tutorials`. The site's tutorial page shows a step's text beside an editor holding that step's files, with a button that swaps in the solution.

## Layout

```
examples/tutorials/
  index.json                  slugs in gallery order
  <slug>/
    tutorial.json             title, description, level, minutes, optional dependencies
    thumbnail.webp            600 × 338 gallery image
    01-<step>/
      step.md                 the step's text
      index.ts                the entry file
      index.completed.ts      optional: the solution for index.ts
      <file>.ts               another editor tab
      <file>.completed.ts     optional: the solution for <file>.ts
```

- Steps are folders, ordered by their two-digit prefix.
- Each step holds every file the reader sees at that point, so it runs and type-checks on its own. Copy the previous step's solution forward as the next step's start.
- In the site's editor, `index.ts` becomes the entry file, src/index.js, and `<file>.ts` becomes `src/<file>.js`. Files import each other as `./<file>`.
- `tutorial.json` has `title`, `description`, `level` (`beginner`, `intermediate` or `advanced`), `minutes`, and optional `dependencies`: npm packages the editor installs, as `{ "name": "version" }`.

## step.md

```md
---
title: Add a view
active: view.ts
hidden:
  - helpers.ts
---

Text for the step, in the guide format: {@link View3D}, alerts, and relative links to guide files.
```

- `title` is required.
- `active` is the file the editor opens first. It defaults to the first file other than `index.ts` that has a `.completed` twin, and otherwise to `index.ts`.
- `hidden` lists files kept out of the editor's tabs, such as helpers carried over from earlier steps.
- The body follows the guide format in `src/__docs__/README.md`, without `@stackblitz` embeds.

## Code

Tutorial code follows the rules for guide examples in `src/__docs__/README.md`: an async IIFE, `preference: 'webgpu'`, assets by absolute URL, and nothing from the playground. Mark where the reader writes code with `/** -- INSERT CODE HERE -- */`. Starting code can leave imports and parameters unused, which `tsconfig.json` allows.

## Checks

- `npm run test:types` type-checks every step.
- `npm run test:docs` type-checks the `ts` fences in every `step.md`.
