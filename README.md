> ### Closed beta
>
> This is a read-only mirror of the private `@pixi/3d` repo, for closed-beta testers.
> The package isn't on npm yet, so install it from the tarball attached to the latest
> [release](../../releases):
>
> ```sh
> npm install pixi.js
> npm install ./pixi-3d-0.0.0.tgz
> ```
>
> Please don't share the code or the builds. Bug reports and feedback go in
> [Issues](../../issues) — they're very welcome.

<p align="center">
  <a href="https://pixijs.com" target="_blank" rel="noopener noreferrer">
    <img height="150" src="https://files.pixijs.download/branding/pixijs-logo-transparent-dark.svg?v=1" alt="PixiJS logo">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/@pixi/3d"><img src="https://img.shields.io/npm/v/@pixi/3d.svg" alt="npm package"></a>
  <a href="https://npmjs.com/package/@pixi/3d"><img src="https://img.shields.io/npm/dm/@pixi/3d" alt="npm downloads"></a>
  <a href="https://opencollective.com/pixijs"><img src="https://opencollective.com/pixijs/tiers/badge.svg" alt="open collective"></a>
</p>
<p align="center">
 <a href="https://pixijs.com/8.x/guides">Guides</a> | <a href="https://pixijs.com/8.x/tutorials">Tutorials</a> | <a href="https://pixijs.com/8.x/examples">Examples</a> | <a href="https://pixijs.download/release/docs/index.html">API Docs</a> | <a href="https://discord.gg/QrnxmQUPGV">Discord</a> | <a href="https://bsky.app/profile/pixijs.com">Bluesky</a> | <a href="https://x.com/pixijs">𝕏</a>
</p>

# PixiJS 3D

> A 3D extension for PixiJS

## Usage

```sh
npm install pixi.js @pixi/3d
```

```ts
import { DirectionalLight, Model3D, View3D } from '@pixi/3d';
import type { Scene3DSource } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application, Assets } from 'pixi.js';

const app = new Application();
await app.init({ preference: 'webgpu', resizeTo: window });
document.body.appendChild(app.canvas);

// A View3D is a 2D container that renders a 3D scene into its rectangle
const view3d = new View3D({
  width: app.screen.width,
  height: app.screen.height,
  environment: { skyColor: 0xdde8ff, groundColor: 0x443322 },
});
app.stage.addChild(view3d);
app.renderer.on('resize', (width, height) => {
  view3d.setSize(width, height);
});

const sun = new DirectionalLight({ intensity: 3 });
sun.rotation.set(-Math.PI / 4, Math.PI / 6, 0);
view3d.root.addChild(sun);

const source = await Assets.load<Scene3DSource>(
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
);
view3d.root.addChild(new Model3D(source));

view3d.camera.position.set(0, 0, 3);
new OrbitCamera({ view: view3d, enableDamping: true });
```

Importing `@pixi/3d` registers the asset loaders and a loader hook for each renderer backend. When `Application.init` picks WebGL or WebGPU, the renderer pulls in that backend's systems and pipes as a separate chunk, so a page only downloads the backend it uses.

To bundle a backend statically instead, import it yourself:

```ts
import '@pixi/3d';
import '@pixi/3d/webgl'; // or '@pixi/3d/webgpu'
```

The static import is required when the renderer is initialised with `skipExtensionImports: true`, which turns the lazy hook off.

Optional pieces sit on their own subpath: the `OrbitCamera` and `FPSCamera` controllers, the debug tools, `ToonMaterial`, `ParticleSystem3D`, and extra post-processing effects.

```ts
import { FPSCamera, OrbitCamera } from '@pixi/3d/extras';
```

### TypeScript

`@pixi/3d` ships its own type declarations. Its WebGPU types come from `pixi.js`, so the setup is the same as in the [PixiJS TypeScript guide](https://pixijs.download/release/docs/core-concepts-8.html).

**TypeScript 5:** no WebGPU types are built in, so `pixi.js` adds [`@webgpu/types`](https://github.com/gpuweb/types) for you. No additional setup required.

**TypeScript 6 and 7:** need `pixi.js` 8.21.0 or later. The WebGPU types are built into the `"dom"` library, but some releases leave parts out, such as `GPUTextureUsage`. Use [`@types/web`](https://www.npmjs.com/package/@types/web), which has the full set, in place of `"dom"`. Remove `@webgpu/types` from `types` if it's there, since it conflicts with the built-in types.

```bash
npm install --save-dev @types/web
```

```json
{
  "compilerOptions": {
    "lib": ["esnext"],
    "types": ["@types/web"]
  }
}
```

## CDN

The CDN build ships inside the npm package under `dist/`, so jsdelivr serves it. The files import `pixi.js` bare, so a page maps that name and the package in an import map, then writes the same code as with npm:

```html
<script type="importmap">
  {
    "imports": {
      "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/pixi.min.mjs",
      "@pixi/3d": "https://cdn.jsdelivr.net/npm/@pixi/3d@1.0.0/dist/pixi-3d.min.mjs",
      "@pixi/3d/extras": "https://cdn.jsdelivr.net/npm/@pixi/3d@1.0.0/dist/pixi-3d-extras.min.mjs"
    }
  }
</script>
<script type="module">
  import { DirectionalLight, Model3D, View3D } from '@pixi/3d';
  import { OrbitCamera } from '@pixi/3d/extras';
  import { Application, Assets } from 'pixi.js';

  // ...the same code as the npm example above
</script>
```
