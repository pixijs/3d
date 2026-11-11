> ### Closed beta
>
> This is a read-only mirror of the private `@pixi/3d` repo, for closed-beta testers.
> The package isn't on npm yet, so install it from the tarball attached to the latest
> [release](../../releases):
>
> ```sh
> npm install pixi.js@^8.23.0
> npm install ./pixi-3d-0.1.0-beta.3.tgz
> ```
>
> **Show us what you make.** Screenshots, clips, half-finished experiments: post them in
> the [PixiJS Discord](https://discord.gg/mZQrcp9BRh) or on X with
> [@pixijs](https://x.com/pixijs). We'd love to share the best of it when 3D launches.
>
> Please keep the code and the builds themselves inside the beta. Bug reports and
> feedback go in [Issues](../../issues); both are very welcome.

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
 <a href="https://discord.gg/QrnxmQUPGV">Discord</a> | <a href="https://bsky.app/profile/pixijs.com">Bluesky</a> | <a href="https://x.com/pixijs">𝕏</a>
</p>

# PixiJS 3D

> Combine 2D and 3D in one place, the PixiJS way.

- 🚀 [WebGL2](https://en.wikipedia.org/wiki/WebGL) & [WebGPU](https://en.wikipedia.org/wiki/WebGPU) Renderers
- 🧩 A 3D View You Add to the Stage Like a Sprite
- 📦 glTF Models, with Draco and meshopt Compression
- 🎨 PBR, Phong and Toon Materials
- 💡 Lights and Shadows
- 🏃 Skinned and Morph-Target Animation
- ✨ Particles
- 🪄 Post-Processing Effects such as Bloom and Ambient Occlusion
- ✋ Pointer Events on 3D Objects

### Setup

It's easy to get started with PixiJS 3D! Just use our [PixiJS Create](https://pixijs.io/create-pixi/) CLI and get set up in just one command:

<p align="center">
  <img width="500" style="border-radius: 10px; filter: drop-shadow(0px 2px 5px #000);;" alt="Screenshot from terminal" src="https://pixijs.io/create-pixi/img/demo.gif">
</p>

```
npm create pixi.js@latest
```

or to add it to an existing project:

```
npm install pixi.js @pixi/3d
```

`@pixi/3d` needs `pixi.js` 8.23.0 or later. [Installation](src/__docs__/getting-started/installation.md) covers the CDN build.

### Usage

```ts
import { CubeGeometry, DirectionalLight, Material3D, Mesh3D, View3D } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

(async () => {
  // Create a new application
  const app = new Application();

  await app.init({ preference: 'webgpu', background: '#1a1a2e', resizeTo: window, antialias: true });
  document.body.appendChild(app.canvas);

  // A View3D draws a 3D scene; its environment lights it from above and below
  const view3d = new View3D({ autoResize: true, environment: { skyColor: 0xc9d6ff, groundColor: 0x3a2f45 } });

  app.stage.addChild(view3d);

  // A red cube, and a sun shining on it
  const cube = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0xdd4444 }) });
  const sun = new DirectionalLight({ intensity: 3 });

  sun.position.set(-3, 5, 2);
  view3d.root.addChild(cube, sun);
  sun.lookAt(cube.position);

  // Move the camera back; drag to orbit it around the cube
  view3d.camera.position.set(0, 1.5, 4);
  new OrbitCamera({ view: view3d });

  // Spin the cube
  app.ticker.add((time) => {
    cube.rotation.y += 0.01 * time.deltaTime;
  });
})();
```

The [Quick start](src/__docs__/getting-started/quick-start.md) builds a scene step by step, and the [Introduction](src/__docs__/getting-started/introduction.md) points to the guide for each part.

### TypeScript

PixiJS 3D ships its own type declarations. Like PixiJS, they depend on the WebGPU types, and where those come from depends on your TypeScript version.

**TypeScript 5:** no WebGPU types are built in, so `pixi.js` adds [`@webgpu/types`](https://github.com/gpuweb/types) for you. No additional setup required.

**TypeScript 6 and 7:** the WebGPU types are built into the `"dom"` library, but some releases leave parts out, such as `GPUTextureUsage`. Use [`@types/web`](https://www.npmjs.com/package/@types/web), which has the full set, in place of `"dom"`. Remove `@webgpu/types` from `types` if it's there, since it conflicts with the built-in types.

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

The types for `@pixi/3d/extras` come through the package's `exports`, so use a `moduleResolution` that reads them, such as `"bundler"`.

### Contribute

Read the [Contributing Guide](.github/CONTRIBUTING.md) before submitting changes.

### License

This content is released under the [MIT License](LICENSE).

<br/>

<h2 align="center">PixiJS Sponsors</h2>

<p align="center">
  We're passionate about making PixiJS the best graphics library possible. Our dedication comes from our love for the project and community.
</p>
<br/>
<p align="center">
  <a href="https://pixijs.com/sponsor"><img src="https://pixijs.com/sponsors-readme.svg" alt="PixiJS sponsors"></a>
</p>
<p align="center">
  <a href="https://namespace.so/github-actions/?utm_source=oss&utm_campaign=pixijs"><img alt="CI powered by Namespace" src="https://namespace.so/oss/badge.svg" height="32" /></a>
</p>
<br/>
<p align="center">
  If you'd like to support our efforts, please consider <a href="https://pixijs.com/sponsor"><b>becoming a sponsor</b></a>.
</p>
