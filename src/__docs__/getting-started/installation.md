---
title: Installation
description: How to install PixiJS 3D from npm or a CDN, how its WebGPU and WebGL2 code loads, and the TypeScript setting it needs.
category: getting-started
---

# Installation

PixiJS 3D is the `@pixi/3d` package. It runs inside a PixiJS application, so you install it next to `pixi.js`.

## npm

```bash
npm install pixi.js @pixi/3d
```

`@pixi/3d` needs `pixi.js` 8.23.0 or later.

Import the engine from `@pixi/3d`, and the optional pieces from `@pixi/3d/extras`:

```ts
import { Mesh3D, View3D } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application } from 'pixi.js';
```

`@pixi/3d/extras` holds optional pieces built on the engine, such as the {@link OrbitCamera} and {@link FPSCamera} controllers, {@link ParticleSystem3D}, {@link ToonMaterial}, the {@link BloomEffect} and other post-processing effects, and debug tools such as {@link GraphDebugOverlay}.

## How the backends load

PixiJS 3D has two backends, one for each of PixiJS's GPU renderers: the code that draws with WebGPU, and the code that draws with WebGL2. Importing `@pixi/3d` registers neither. `app.init` loads and registers the one for the renderer it starts. A production build from a bundler such as Vite, and the CDN build, put each backend in a file of its own, so a browser downloads only the one it uses. Import `@pixi/3d` before `app.init` runs: a renderer started earlier, as when the 3D code arrives in a lazily loaded chunk of a running 2D app, never gets a backend, and a {@link View3D} on it draws nothing.

`skipExtensionImports: true` stops PixiJS importing extensions for you and stops `app.init` loading a backend, so import the backends yourself; each one goes in your main bundle. Import every backend the page can end up with: with `preference: 'webgpu'` that's both, since PixiJS falls back to WebGL2 where WebGPU is missing. Without the renderer's backend, a {@link View3D} draws nothing.

```ts
import '@pixi/3d/webgl';
import '@pixi/3d/webgpu';
// PixiJS's events, filters, accessibility and DOM extensions are off too, so import the ones the page uses
import 'pixi.js/events';

await app.init({ preference: 'webgpu', skipExtensionImports: true });
```

## CDN

jsDelivr serves the CDN build in the npm package's `dist` folder. Its files import `pixi.js` by name, so map that name, `@pixi/3d` and `@pixi/3d/extras` in an import map, then write the same code as with npm:

```html
<script type="importmap">
  {
    "imports": {
      "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8.23.0/dist/pixi.min.mjs",
      "@pixi/3d": "https://cdn.jsdelivr.net/npm/@pixi/3d@0.1.0-beta.3/dist/pixi-3d.min.mjs",
      "@pixi/3d/extras": "https://cdn.jsdelivr.net/npm/@pixi/3d@0.1.0-beta.3/dist/pixi-3d-extras.min.mjs"
    }
  }
</script>
<script type="module">
  import { View3D } from '@pixi/3d';
  import { OrbitCamera } from '@pixi/3d/extras';
  import { Application } from 'pixi.js';

  // the same code as with npm
</script>
```

Take `Application` and the rest of PixiJS from the mapped `pixi.js` too. Loading PixiJS with a plain `<script>` tag defines a global `PIXI`, a second copy of PixiJS that PixiJS 3D doesn't register with. A {@link View3D} in an application made from it draws nothing.

Map `@pixi/3d` and `@pixi/3d/extras` to files in the same folder, both minified or both not. The extras file imports the engine file beside it, so any other `@pixi/3d` URL, such as another version, makes the page download and run a second copy of the engine.

To host the files yourself, keep every `pixi-3d` file from `dist` together in one folder: the main file fetches the backend its renderer uses, and the meshopt decoder for [compressed models](../../assets/__docs__/compression.md), from its own folder. Draco-compressed models still fetch their decoder from Google until you [host it too](../../assets/__docs__/compression.md#draco).

## TypeScript

`@pixi/3d` ships its type declarations. They use the same WebGPU types as `pixi.js`, so a project set up as the [PixiJS TypeScript guide](https://pixijs.download/release/docs/core-concepts-8.html) shows already has them.

The types for `@pixi/3d/extras` come through the package's `exports`, so use a `moduleResolution` that reads them, such as `"bundler"`. The older `"node"` setting can't find them.

## Next steps

- [Quick start](./quick-start.md): build a first scene.
- [WebGL and WebGPU](../concepts/webgl-and-webgpu.md): what differs between the two backends.
