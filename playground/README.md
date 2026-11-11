# Playground

The playground is for maintainers: a scene here shows what a change, an issue or a PR does. Examples teach users, so a scene that shows a change belongs here, not in `examples/`. To guard the picture in CI too, write a visual scene (`tests/README.md`).

`npm start` serves the playground on `http://localhost:5173`. It reads `src/` directly, so an edit reloads with no build step. The first start downloads the remote assets.

## Adding a scene

A scene is a `*.playground.ts` file anywhere under `playground/`. `src/scenes/sceneDiscovery.ts` finds it and uses its basename as the scene's ID, so the basename must be unique. A scene for an issue is `issue-<number>.playground.ts`, and one for a PR is `pr-<number>.playground.ts`.

`default.playground.ts` is the template:

- The file default-exports an async function that builds the app.
- `app.init()` takes `rendererPreference` from `src/getPreference.ts`, which reads the page's `renderer` parameter, so switching renderers works.
- Imports come from `@pixi/3d`, `@pixi/3d/webgl`, `@pixi/3d/webgpu` and `@pixi/3d/extras`, which `vite.config.ts` points at `src/`. Like an example, a scene uses only the public API (`CODING_STANDARDS.md`).
- Assets load through the accessors in `examples/assets/manifest.ts`, such as `model('gltf.Avocado')` or `texture('pixijs.Bunny')`, which give the URL of the downloaded copy under `/mirror/`. `/test-assets/` serves the files committed in `examples/assets`.

## Opening a scene

- In the playground UI: `http://localhost:5173/?tab=playground&scene=<id>&renderer=webgpu`. Switch to `renderer=webgl` to compare the backends.
- On its own, with no UI around it, for a screenshot: `http://localhost:5173/scene-frame.html?type=playground&id=<id>&renderer=webgpu`. `type=example` opens an example by its folder or file name. `src/scene-frame-entry.ts` reads these parameters.
- Headless Chromium draws WebGPU only with the flags `vitest.config.ts` launches it with, `--enable-gpu --enable-unsafe-webgpu`. Without them a WebGPU screenshot comes out blank.
- On a phone: `npm start -- --host`. WebGPU needs HTTPS off `localhost`; `vite.config.ts` covers the certificate and tunnel options beside `PLAYGROUND_HTTPS_KEY`.

The Tests tab runs the visual test scenes too, but at 256x256, so its pictures don't match the test suite's reference images.
