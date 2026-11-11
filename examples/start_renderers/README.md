# WebGL and WebGPU

One scene on either GPU backend. pixi picks WebGPU or WebGL at `app.init` from the `preference` list, and
`app.renderer.name` says which one it picked; the scene code names no backend, so the same lines draw the same frame on
both. The picture shows the PixiJS logo over an arc of seven clay shapes, running on WebGPU. The page also imports
`@pixi/3d/webgl`, which bundles the WebGL backend with the page; without it, `app.init` fetches whichever backend it
picks.

![The pink PixiJS logo floating over an arc of seven clay shapes on the light checker floor: a pink cube, a pale pink capsule, a purple sphere, a lilac puck, a sky pyramid, a pale sky octahedron and an orange torus; the pane in the top right shows preference WebGPU, then WebGL and renderer.name webgpu](reference.png)

## API

- `preference` in `app.init`, a list of `RendererPreference` values from `pixi.js`: the only backends pixi may use, in
  the order it tries them. A list, not a string: a string names only the first choice and lets pixi fall back to its
  canvas renderer, which `@pixi/3d` can't draw with. The choice is fixed for the renderer's life.
- `app.renderer.name`: `'webgpu'` or `'webgl'`, the backend that runs. Code that branches on the backend compares
  `app.renderer.type` with `RendererType.WEBGPU`, as the engine does.
- `import '@pixi/3d/webgl'`: puts the WebGL backend in the page's bundle, so `app.init` has nothing of `@pixi/3d`'s to
  fetch when it picks WebGL, and WebGPU stays a chunk it fetches only if it picks WebGPU. A real page takes one way:
  no import, or this one with `preference: ['webgl']` to ship WebGL alone (`@pixi/3d/webgpu` with `['webgpu']` ships
  WebGPU alone, with no fallback). Don't add `skipExtensionImports`: a static import doesn't need it, and it turns off
  pixi's own browser extensions too, pointer events among them.
- `View3D`, its `camera` and `Mesh3D`: the scene, built the same way on both backends.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `preference` reloads the page with the other order, since a backend can't change under a running renderer;
  `renderer.name` shows the backend pixi picked.

## Files

- `index.ts`: the lesson. The backend import, the `preference` list, the pane and the reload.
- `scene.ts`: the logo over the arc of clay shapes, and their bob and sway, driven by elapsed time so both backends
  replay the same motion.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `clayGeometry`, `clayMaterial`,
`ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Hello cube](../start_hello-cube/README.md): the smallest scene, an app, a view, a cube and a light.
- [Model viewer](../start_model-viewer/README.md): a scene loaded from a glTF file.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- start_renderers` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
