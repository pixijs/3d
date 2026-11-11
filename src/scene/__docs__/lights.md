---
title: Lights
description: Ambient, directional, point and spot lights, how to aim them and give them a range, and how many lights a view draws.
category: scene
children:
  - ./shadows.md
---

# Lights

A {@link BaseMaterial3D#lit | lit} material, such as {@link Material3D}, shows the light that reaches it. With no lights, and no {@link View3D#environment | environment} to light it from its surroundings, a {@link Material3D} mesh draws black, apart from its {@link Material3DOptions#emissive | emissive} glow and what shows through {@link Material3DOptions#transmission | glass}. An unlit material, such as {@link FlatMaterial}, ignores lights.

Lights are {@link Container3D} objects, like meshes. Add one anywhere under {@link View3D#root | view3d.root} and it can light any lit mesh in that view, not just its siblings. Setting {@link Container3D#visible | visible} to `false` on it, or on a parent, switches it off. A light draws nothing itself; [Scene objects](./scene.md#putting-a-scene-together) shows how to hang a glowing bulb on one.

## The four kinds

- {@link DirectionalLight}: parallel light from one direction, like the sun.
- {@link PointLight}: light in every direction from a point, like a bulb.
- {@link SpotLight}: a cone of light from a point, like a torch.
- {@link AmbientLight}: the same light on every surface, from no direction.

[Light types](/3d/examples?example=lighting_light-types) lights one scene with all four, and shows each alone so you can see what it adds.

Directional and spot lights can {@link Light#castShadow | cast shadows}, which [Shadows](./shadows.md) covers. A typical scene has one directional light, plus a softer fill for the sides it doesn't reach:

```ts
import { AmbientLight, DirectionalLight } from '@pixi/3d';

const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 3, castShadow: true });

sun.position.set(5, 10, 5);
view3d.root.addChild(sun);
sun.lookAt({ x: 0, y: 0, z: 0 });

view3d.root.addChild(new AmbientLight({ intensity: 0.3 }));
```

## Colour and intensity

Every light has a {@link Light#color | color}, which takes any colour PixiJS accepts, and an {@link Light#intensity | intensity} that scales it. Change them whenever you like:

```ts
sun.color = 0xff9a4d; // sunset
sun.intensity = 2;
```

Intensities above 1 are normal. Tone mapping is how the view turns lit colour into screen colour. Under the view's default {@link View3D#toneMapping | toneMapping}, `'none'`, a white {@link Material3D} surface facing a directional light of intensity 1 shows mid grey, about 3 brings it to white, and anything brighter clips to white. A curve such as `'aces'` rolls bright light off instead of clipping it; see [Tone mapping and exposure](./environment.md#tone-mapping-and-exposure).

Point and spot lights dim with the square of the distance. A lamp 3 units from a surface needs about 9 times a directional light's intensity to light it as brightly.

The same square makes a small, very bright spot on a surface close to the light, such as the ground under a lantern or a campfire. Brightness levels off closer to the light than its radius ({@link PointLight#radius}, {@link SpotLight#radius}), so to soften the spot, raise the radius past the light's distance from the surface: for a lantern 0.3 above the ground, try 0.6. Surfaces farther than about twice the radius barely change.

## Aiming lights and making them follow

Directional and spot lights shine along their local -Z axis, the way a camera looks, so {@link Container3D#lookAt | lookAt} aims them at a point. Only the way a directional light faces changes its light, so its position just gives `lookAt` a point to aim from. A point light shines every way, so only its position matters.

To make a light follow something, add it as a child. A directional light under the camera lights whatever the camera faces:

```ts
view3d.camera.addChild(new DirectionalLight({ intensity: 2 }));
```

## Range

Give point and spot lights a range ({@link PointLight#range}, {@link SpotLight#range}), as small as the look allows. The light fades smoothly to nothing at that distance, and the view skips it on the parts of the screen it doesn't reach. A light with no range never quite fades to zero, so the view shades it on every lit pixel, which adds up with many lights.

```ts
import { PointLight } from '@pixi/3d';

const lamp = new PointLight({ color: 0xffd180, intensity: 8, range: 12 });

lamp.position.set(0, 2.5, 0);
view3d.root.addChild(lamp);
```

## Spot lights

A spot light's {@link SpotLight#coneAngle | coneAngle} is the angle from the cone's centre to its edge, in degrees, so the cone is twice as wide. {@link SpotLight#penumbra | penumbra}, from 0 to 1, softens the edge.

```ts
import { SpotLight } from '@pixi/3d';

const spot = new SpotLight({ intensity: 40, range: 12, coneAngle: 28, penumbra: 0.4, castShadow: true });

spot.position.set(3, 5, 3);
view3d.root.addChild(spot);
spot.lookAt({ x: 0, y: 0, z: 0 });
```

Point lights cast no shadows. For a lamp that throws one, aim a spot light at what it lights.

## Ambient light

An {@link AmbientLight} keeps shadowed sides off pure black, but on its own it flattens shapes, since every side gets the same amount.

On a {@link Material3D}, ambient light fades as {@link Material3DOptions#metallic | metallic} rises, so a full metal, at 1, gets nothing from it. Light metals with an [environment](./environment.md) instead. A {@link Hemisphere} environment also makes a fill that keeps shapes' depth, since it lights surfaces facing up and down in different colours.

## How many lights a view draws

A view shades at most {@link MAX_LIGHTS | 32} directional, point and spot lights. Ambient and hidden lights don't count. Past the limit, the view silently leaves out the visible lights that come last in {@link View3D#lights | view3d.lights}, which lists them in the order they joined the scene. If you have more, hide the ones that matter least, such as those far from the camera.

Shadows have a limit of their own, which [the shadow budget](./shadows.md#the-shadow-budget) explains.

## Lights from model files

A glTF file can bring its own directional, point and spot lights; [Loading models](../../assets/__docs__/models.md#what-a-file-can-bring) covers them. When the file brings none, {@link View3D.from} adds a {@link DirectionalLight} under the camera; set its {@link View3DFromOptions#light | light} option to `false` when you add lights of your own.

## Next steps

- [Shadows](./shadows.md): casting shadows, their quality, and cascades for large worlds.
- [Environment and IBL](./environment.md): light from the surroundings, tone mapping and exposure.
- [Materials](../../materials/__docs__/materials.md): how surfaces respond to light.
