---
title: Porting from Three.js
description: Move a Three.js app to PixiJS 3D, starting with the differences that still compile after a rename but change the picture.
category: getting-started
---

# Porting from Three.js

Most of a Three.js port is renaming. What takes care is the code that compiles and runs after the rename, then draws a darker scene, a sideways light or a floor that casts a shadow. This page lists those differences first, then ports a small scene line by line. The API reference covers every name; the `pixijs-3d` agent skill that ships in the npm package also has full Three.js name tables.

## How the pieces map

- **The scene is one display object in a PixiJS app.** There's no renderer to own: create an `Application`, add a {@link View3D} to its stage, and build the scene under {@link View3D#root | view3d.root}. 2D sprites, text and UI share the canvas, as [View3D and the 2D/3D bridge](../concepts/view3d.md) explains.
- **The view holds the scene-wide settings** that Three.js splits between the renderer and the scene: {@link View3D#toneMapping | toneMapping}, {@link View3D#exposure | exposure}, {@link View3D#shadowQuality | shadowQuality}, {@link View3D#fog | fog}, {@link View3D#background | background}, {@link View3D#environment | environment} and the post-processing {@link View3D#passes | passes}.
- **Constructors take one options object**, such as `new CubeGeometry({ width, height, depth })`, and the same values are properties afterwards.
- **The frame loop is `app.ticker`.** Its callback gets the ticker, and {@link OrbitCamera}, a model's {@link Model3D#player | player} and {@link ParticleSystem3D} advance on `Ticker.shared` unless you step them yourself.
- **A loaded glTF is a template.** `Assets.load` returns a {@link Scene3DSource}, and each {@link Model3D} built from it shares its geometry, materials and textures; see [Loading models](../../assets/__docs__/models.md).

## Differences that change the picture

Each line compiles after a plain rename and still changes what you see. The first group catches nearly every port.

**Light and shadow**

- A HemisphereLight becomes the view's environment, a {@link Hemisphere}, and Three.js divides its intensity by π where the view doesn't: pass `intensity: i / Math.PI`. Directional, point, spot and ambient intensities port unchanged.
- Lights have no target. Directional and spot lights shine down their local -Z, so call {@link Container3D#lookAt | lookAt} after placing one, and again after every move ([Lights](../../scene/__docs__/lights.md#aiming-lights-and-making-them-follow)). An unrotated {@link DirectionalLight} shines sideways, not down.
- Meshes and models cast and receive shadows {@link Mesh3D#castShadow | by default}. Set `castShadow: false` on floors and terrain, which otherwise also stretch the sun's shadow box.
- {@link LightShadow#bias | shadow.bias} has the opposite sign, so negate a Three.js value or keep the default. `shadow.mapSize` is the view's `shadowQuality`, and the shadow camera's box is {@link LightShadow#bounds | shadow.bounds}, a box in world space.

**Time**

- `ticker.deltaTime` counts 60 fps frames. For getDelta() seconds use `ticker.deltaMS / 1000`, which is capped at 100 ms, so below 10 fps motion slows down.
- Where Three.js called `controls.update()` or `mixer.update(dt)` in the loop, build the controller or model with `autoUpdate: false` and call its `update(ticker)` from `app.ticker`, so it steps in the same frame as your code.
- The camera defaults to a field of view of 60 and a far plane of 1000 ({@link Camera3D#fov}, {@link Camera3D#far}), where Three.js apps usually pass 50 and 2000: set both.

**Colour and output**

- Tone mapping is off by default in both. {@link View3D#exposure | exposure} scales the light even under `'none'`, where Three.js ignores it, so port a NoToneMapping app with exposure 1.
- `scene.background` becomes the view's {@link View3D#background | background}, which post effects and fog cover as they do in Three.js. Under a curve such as `'aces'` that background goes through the curve too; for an exact colour, pass `backgroundColor` to `app.init` instead.
- An emissive colour is an opt-in group, `emissive: { color, strength }`, and its colour defaults to white. Pass the group only where the Three.js emissive isn't black.

**Surfaces**

- {@link BaseMaterial3D#alphaMode | alphaMode} defaults to `'opaque'`, which ignores `alpha` and texture alpha: `transparent: true` becomes `'blend'`, and alphaTest becomes `'mask'` with `alphaCutoff`.
- Images upload without Three.js's `flipY`, so a picture on a {@link PlaneGeometry} needs `flipV: true` ([Textures on the built-in shapes](../../geometry/__docs__/geometry.md#textures-on-the-built-in-shapes)).
- Mipmaps are off by default. Load a tiled or distant texture with `Assets.load({ src, data: { autoGenerateMipmaps: true } })`, or it shimmers.
- Texture `repeat` and `offset` become the material's {@link Material3D#uvTransform | uvTransform}, a PixiJS `Matrix` that applies to all its textures. Base colour and emissive textures always decode as sRGB, so `colorSpace` has nothing to port to.

**Scene graph**

- `rotation` and `quaternion` aren't kept in sync. Nodes from a glTF file, and nodes after `lookAt`, keep their turn in the quaternion, so `rotation.y += a` throws it away ([Rotation and quaternion](../concepts/scene-graph.md#rotation-and-quaternion)).
- {@link Container3D#getLocalBounds | getLocalBounds} measures in the node's own space, without its own transform, where Box3.setFromObject measures in world space.
- An animation crossFadeTo is two playing states whose {@link AnimationState#weight | weights} you ramp, and `play()` stops nothing ([Blending and crossfades](../../animation/__docs__/animation.md#blending-and-crossfades)).

## A scene, side by side

A Three.js scene with a hemisphere light, a shadowed sun, a ground, a spinning box and orbit controls:

```js
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc7ea);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(4, 3, 8);
const controls = new OrbitControls(camera, renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a5040, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
sun.position.set(4, 8, 5);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x7a9a5a }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd9534f }));
box.position.y = 0.5;
box.castShadow = true;
scene.add(box);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  box.rotation.y += timer.getDelta();
  controls.update();
  renderer.render(scene, camera);
});
```

The same scene in PixiJS 3D. The comments mark each line that's more than a rename.

```ts
import { CubeGeometry, DirectionalLight, Material3D, Mesh3D, PlaneGeometry, View3D } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
document.body.appendChild(app.canvas);

const view3d = new View3D({
  autoResize: true, // follows the app's size, so no resize listener
  background: 0x9cc7ea,
  environment: { skyColor: 0xdfeeff, groundColor: 0x5a5040, intensity: 1.5 / Math.PI }, // divide by π
});
app.stage.addChild(view3d);

view3d.camera.fov = 50; // the default is 60
view3d.camera.far = 100;
view3d.camera.position.set(4, 3, 8); // before the controller, which keeps this offset
const orbit = new OrbitCamera({ view: view3d, autoUpdate: false });

const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 2.5, castShadow: true, position: { x: 4, y: 8, z: 5 } });
view3d.root.addChild(sun);
sun.lookAt({ x: 0, y: 0, z: 0 }); // no target: aim it

const ground = new Mesh3D({
  geometry: new PlaneGeometry({ width: 20, height: 20 }),
  material: new Material3D({ baseColor: 0x7a9a5a }),
  rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // lies in XY like Three.js's, so lay it flat
  castShadow: false, // meshes cast by default
});
view3d.root.addChild(ground);

const box = new Mesh3D({
  geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
  material: new Material3D({ baseColor: 0xd9534f }),
  position: { x: 0, y: 0.5, z: 0 },
});
view3d.root.addChild(box);

app.ticker.add((ticker) => {
  box.rotation.y += ticker.deltaMS / 1000; // deltaTime counts frames
  orbit.update(ticker); // stepped here, like controls.update()
});
```

## Next steps

- [Quick start](./quick-start.md): the same pieces built up one step at a time.
- [Environment and IBL](../../scene/__docs__/environment.md): tone mapping, exposure, fog and cube maps.
- [Shadows](../../scene/__docs__/shadows.md): the shadow box, cascades and fixing artefacts.
- [Materials](../../materials/__docs__/materials.md#picking-a-material): choosing between the physically based, Phong, flat and toon materials.
