# Writing guides

The Markdown files in `src/**/__docs__` are the PixiJS 3D guides. pixijs.com publishes them under `/3d/guides`, and typedoc renders them beside the API reference. They use pixi.js's own `__docs__` format, so the site builds the 2D and 3D guides with the same pipeline.

## Where pages go

- A page lives in the `__docs__` folder of the module it documents, such as `src/scene/__docs__/cameras.md`. Pages that span modules, which are the getting-started and concept pages, live here in `src/__docs__`.
- `src/index.docs.ts` lists the top page of each category with `@document`, in sidebar order. Every other page is a child, and its parent lists it under `children` in its front matter.
- Images go in a `media` folder beside the page.

## Front matter

```yaml
---
title: Cameras
description: One sentence for search results and link previews.
category: scene
children:
  - ./controls.md
---
```

- `title`: the page and sidebar name. A category's top page can be titled Overview, and the site then labels it with its H1.
- `description`: one sentence. Quote it if it contains a colon followed by a space.
- `category`: one of the categories in `categoryOrder` in `.configs/typedoc.json`.
- `children`: optional; pages listed under this one, as paths relative to it.
- sidebar_position: optional; a number that orders the page among its siblings.

The site drops any other field.

## Body

```md
# Cameras

Every view comes with a {@link Camera3D}, at {@link View3D#camera | view3d.camera}.
{@link View3D.from} frames a model, and `Assets.load` loads it.
See [Lights](./lights.md) and the [PixiJS guides](https://pixijs.com/8.x/guides).

> [!TIP]
> One sentence the reader shouldn't miss.

[Orbit camera](/3d/examples?example=cameras_orbit) orbits the PixiJS logo as you drag.
```

- Start with a `# H1`.
- Name the API with `{@link Name}`, `{@link Name.member}` for a static member, `{@link Name#member}` for an instance member, or `{@link Name#member | label}`. Typedoc checks every link.
- Write pixi.js names as code, such as `Assets.load`, or link the PixiJS docs with a Markdown link. Typedoc can't resolve a pixi.js name in a guide's `{@link}`.
- Link other guides by the relative path to their Markdown file, and anything else with a Markdown link. Never wrap a URL in `{@link}`.
- Write callouts as GitHub alerts: NOTE, TIP or WARNING.
- Link a gallery example as `[its title](/3d/examples?example=<folder>)`, where `<folder>` is its folder in `examples/` and the title is the H1 of its `README.md`, as pixi.js's guides link theirs. Say what it shows that the page teaches.
- Don't embed live examples for now; [Examples](#examples) says why. When they come back, `@stackblitz(<example name>)` on a line of its own embeds a file from the `examples` folder inside a module's `__docs__` folder.
- Fence code as `ts`. Every `ts` fence compiles against the source. A snippet can use names it assumes from context, such as `app` or `view3d`, without declaring them.

## Scope and audience

A guide teaches how the pieces fit together and how to do the tasks people come to it for. The API reference, built from the JSDoc, owns each member's detail: every option, default, unit and limit. Someone has to keep every line of a guide true, so a page says what only a guide can say and links to the rest.

- Readers know PixiJS 2D and are new to 3D. Every sentence passes the user test in "Comments and JSDoc" of `CODING_STANDARDS.md`. A reader who knows the sentence would write different code, or would understand what their code does.
- Write the code a 2D developer reaches for first, run it, and say what happens. These 2D habits all surprise them in 3D: setting `tint` or `alpha` on a mesh, flipping with `scale.x = -1`, reordering children to bring something to the front, moving `view3d.root` to scroll, and recolouring one mesh through a material it shares. Most of what a page leaves out is a habit like these.
- Scenarios and snippets come from what people build, as the gallery in `examples/` shows. Don't invent a use to show off an API. Name only examples a reader can open: a gallery example or a tutorial. The `examples/*.example.ts` files aren't published.
- Explain a 3D term in a few plain words the first time a page uses it. Call each thing by its name in the code, and use one name for one idea.
- Most pages run 60 to 150 lines. Cut what a reader can do without.

## Accuracy

Everything on a page is a claim: each sentence, table cell and code comment, each link, and what each snippet and example does when run.

- Check each claim against the code under `src`, and against `.repos/pixijs` for what pixi does. Never check it against the JSDoc or another page, since they can be wrong too. A claim that holds on only WebGL or only WebGPU says which.
- A sentence about meshes, lights or nodes holds for every subclass. `Sprite3D`, `ParticleContainer3D`, a `BatchedMesh3D` slot and `Model3D` break most rules written for meshes, and a `PointLight` most rules written for lights. Check each before you write "every", "never" or a default, or name the class you mean. Write a default as "by default" and link the member that sets it.
- A list reads as complete. Read every branch of the code before you write one, or write "such as" and link the member that owns the full list.
- "Before", "only", "must" and "is skipped" say something about the other case too, so try the other case: the other order, hidden rather than removed, a dev server as well as a build, another texture format, a post effect on, a value either side of a limit.
- Open each "the next step", each "below" and each link, and find the sentence it promises. Link a section's anchor rather than the top of a long page. `check-guides` follows only `{@link}`, so open each link to another guide yourself. When you rename a heading, search the guides for links to it.
- Run each snippet as a reader would paste it: what it builds is in the scene, each option it passes differs from the default, and it does the same as the example it says it copies. Then try the reader's next move, such as swapping in their own model.
- State a default, number or limit only where the reader needs it to follow the page, and link the member that owns it. Never state one that only an `@internal` constant holds, since the reader can't look it up. Link every API the page states a fact about at least once.
- A fact lives on one page; the others link to it. Search the other guides before you state one, so two pages never disagree.
- When the code breaks what its name or JSDoc promises, don't explain the breakage. When someone fixes the bug, the page becomes wrong and nothing flags it. Narrow the claim instead. If readers would hit the bug doing what the page teaches, steer them around it in one clause. Then report the bug.

## Voice

Follow "Communication" in `AGENTS.md`: plain words, short sentences, the active voice.

## Examples

The gallery lives in `examples/`, one folder per example, and `examples/README.md` says how to write one. For now, guides link gallery examples and embed none. Live embeds are off until pixijs.com can run the gallery's examples, which import the theme kit in `examples/shared/`, Tweakpane and assets that only the playground serves. Until then no `__docs__` folder holds an example.

The embed tools stay for when live embeds come back. The typedoc plugin in `scripts/typedoc/plugins/typedoc-plugin-stackblitz.mjs`, the embed check in `check-guides` and the playground still pick up guide examples. As in pixi.js, a guide example lives in an `examples` folder inside the `__docs__` folder of the module the guide documents, and follows pixi.js's example format:

- The file is `<category>_<name>.ts`, with each part in kebab-case.
- The first line is `// description: <one sentence>`. Comments after it teach; they don't record how the example came about. The description, the comments and any text the example shows are claims. If they say something floats, sits inside something or moves, the preview has to show it. Work out the positions and sizes, and look at the example inside the page's embed as well as in the playground.
- Import only from `pixi.js`, `@pixi/3d` and `@pixi/3d/extras`. Never import `@pixi/3d/webgl` or `@pixi/3d/webgpu`.
- Wrap the code in `(async () => { ... })();` rather than using top-level `await`.
- Start the application with `preference: 'webgpu'`, `resizeTo: window`, `antialias: true`, a `background`, `resolution: Math.min(window.devicePixelRatio, 2)` and `autoDensity: true`.
- Load files by absolute URL. A file in `examples/assets/` is `https://pixijs.com/assets/3d/<path>`, and PixiJS's own assets are `https://pixijs.com/assets/<file>`. Khronos sample models load from jsDelivr, pinned to one commit of glTF-Sample-Assets. Name a third-party model's author, licence and source in a comment where the example loads it.
- Don't use TypeScript parameter properties or enums. The site strips types without compiling.
- Make it work from 320 pixels wide and on touch, and keep it at 60 frames a second on a mid-range phone. Lower the counts in a stress test on touch devices and small screens.

`npm start` runs the playground, which lists every gallery and guide example under its category. It serves `examples/assets/` in place of the published assets under pixijs.com/assets/3d, so an asset works before the site publishes it. Restart it after adding an example file, since it looks for example files only when it starts.

## Checks

`npm test` and CI both run `npm run test:docs`, which runs these checks:

- It type-checks the `ts` fences in the guides, the tutorial steps and `README.md`.
- It fails on a `{@link}` that names nothing public, and on an `@stackblitz` embed that names no guide example. No guide embeds one while live embeds are off. While you edit one page, `node scripts/typedoc/check-guides.mts <page>` checks just that page.
- It fails on a code span that names a file or symbol that doesn't exist.
- It fails on a relative link or `#anchor` in any Markdown file that leads nowhere, and on a gallery link that names no example.

`npm run build:docs` fails on any warning, such as a broken `{@link}` or an unknown `@stackblitz` name, and runs in CI.
