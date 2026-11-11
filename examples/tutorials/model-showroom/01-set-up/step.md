---
title: Set up the view
---

Welcome to Model Showroom. You'll load an animated fox from a glTF file, the usual file format for 3D models, and light it with a photo of a real place. Then you'll put it on a stand and add a camera that circles it, 2D buttons that switch its animations, and a label pinned to its head. This tutorial assumes you've built a scene with a {@link View3D} before; [Floating Shapes](https://pixijs.com/3d/tutorials/floating-shapes) covers the basics.

The starting code creates the application. Work in `index.ts`, below it.

## A view and two test balls

Before the fox arrives, two balls will show what the light in the scene looks like. Add a view, the balls and a sun:

```ts
const view3d = new View3D({ autoResize: true });

app.stage.addChild(view3d);
view3d.camera.position.set(0, 0, 5);

const geometry = new SphereGeometry({ radius: 0.55 });
const mirror = new Mesh3D({
  geometry,
  material: new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: 0.05 }),
});
const matte = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xf06695, roughness: 0.6 }) });

mirror.x = -0.65;
matte.x = 0.65;
view3d.root.addChild(mirror, matte);

const sun = new DirectionalLight({ intensity: 2 });

sun.position.set(1, 1, 0.4);
view3d.root.addChild(sun);
sun.lookAt({ x: 0, y: 0, z: 0 });
```

- The two balls share one {@link SphereGeometry}, the way two sprites share a texture, and each has its own {@link Material3D}.
- {@link Material3DOptions#metallic | metallic} at 1 makes a metal, and a {@link Material3DOptions#roughness | roughness} near 0 polishes it. A metal shows only what it reflects, and a polished one reflects like a mirror.
- The matte ball is a non-metal, the default, and its rougher surface spreads out the light it reflects.
- The {@link DirectionalLight} shines from the upper right toward the middle of the scene.

The pink ball is lit on its upper right. The mirror ball is black apart from one small bright dot, its reflection of the sun, because there's nothing else around it to reflect. In the next step you'll give it something.
