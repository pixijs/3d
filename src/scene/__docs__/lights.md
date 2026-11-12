---
title: Lights
description: Ambient, directional, point and spot lights, how to aim them and give them a range, and how many lights a view draws.
category: scene
children:
  - ./shadows.md
---

# Lights

A {@link BaseMaterial3D#lit | lit} material, such as {@link Material3D}, shows the light that reaches it. An {@link View3D#environment | environment} lights a scene from its surroundings. With no lights and no environment, a {@link Material3D} mesh draws black. Only its {@link Material3DOptions#emissive | emissive} glow and what shows through {@link Material3DOptions#transmission | glass} stay visible. An unlit material, such as {@link FlatMaterial}, ignores lights.

Lights are {@link Container3D} objects, like meshes. Add one anywhere under {@link View3D#root | view3d.root} and it can light any lit mesh in that view, not just its siblings. Setting {@link Container3D#visible | visible} to `false` on the light, or on a parent, switches it off. The light itself draws nothing. [Scene objects](./scene.md#putting-a-scene-together) shows how to give one a glowing bulb mesh as a child.

## Light types

- {@link DirectionalLight}: parallel light from one direction, like the sun.
- {@link PointLight}: light in every direction from a point, like a bulb.
- {@link SpotLight}: a cone of light from a point, like a torch.
- {@link AmbientLight}: the same light on every surface, from no direction.

[Light types](/3d/examples?example=lighting_light-types) lights one scene with all four, and shows each alone so you can see what it adds.

Directional and spot lights can {@link Light#castShadow | cast shadows}, which [Shadows](./shadows.md) covers. A typical scene has one directional light, plus a dimmer fill light for the sides it doesn't reach:

```ts
import { AmbientLight, DirectionalLight } from '@pixi/3d';

const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 3, castShadow: true });

sun.position.set(5, 10, 5);
view3d.root.addChild(sun);
sun.lookAt({ x: 0, y: 0, z: 0 });

view3d.root.addChild(new AmbientLight({ intensity: 0.3 }));
```

## Colour and intensity

Every light has a {@link Light#color | color}, which takes any colour PixiJS accepts, and an {@link Light#intensity | intensity} that scales it. You can change both at any time:

```ts
sun.color = 0xff9a4d; // sunset
sun.intensity = 2;
```

Intensities above 1 are normal. Tone mapping is how the view turns lit colour into screen colour. The view's default {@link View3D#toneMapping | toneMapping} is `'none'`. Under it, a white {@link Material3D} surface facing a directional light of intensity 1 shows mid grey. An intensity of about 3 brings it to white, and anything brighter clips to white. A curve such as `'aces'` compresses bright light gradually instead of clipping it; see [Tone mapping and exposure](./environment.md#tone-mapping-and-exposure).

Point and spot lights dim with the square of the distance. A lamp 3 units from a surface needs about 9 times a directional light's intensity to light it as brightly.

The same rule makes a small, very bright spot on a surface close to the light, such as the ground under a lantern or a campfire. Closer to the light than its radius ({@link PointLight#radius}, {@link SpotLight#radius}), brightness levels off. To soften the spot, raise the radius past the light's distance from the surface. For a lantern 0.3 above the ground, try 0.6. Surfaces farther away than about twice the radius barely change.

## Aiming lights and making them follow

Directional and spot lights shine along their local -Z axis, the way a camera looks, so {@link Container3D#lookAt | lookAt} aims them at a point. For a directional light, only the direction it faces matters. Its position just gives `lookAt` a point to aim from. A point light shines in every direction, so only its position matters.

To make a light follow an object, add the light as a child of that object. A directional light under the camera lights whatever the camera faces:

```ts
view3d.camera.addChild(new DirectionalLight({ intensity: 2 }));
```

## Range

Give point and spot lights a range ({@link PointLight#range}, {@link SpotLight#range}), the smallest one that still looks right. The light fades smoothly to nothing at that distance, and the view skips it on the parts of the screen it doesn't reach. A light with no range never quite fades to zero, so the view shades it on every lit pixel. With many lights, that cost adds up.

```ts
import { PointLight } from '@pixi/3d';

const lamp = new PointLight({ color: 0xffd180, intensity: 8, range: 12 });

lamp.position.set(0, 2.5, 0);
view3d.root.addChild(lamp);
```

## Spot lights

A spot light's {@link SpotLight#coneAngle | coneAngle} is the angle from the cone's centre to its edge, in degrees, so the whole cone spans twice that angle. Its {@link SpotLight#penumbra | penumbra}, from 0 to 1, softens the edge.

```ts
import { SpotLight } from '@pixi/3d';

const spot = new SpotLight({ intensity: 40, range: 12, coneAngle: 28, penumbra: 0.4, castShadow: true });

spot.position.set(3, 5, 3);
view3d.root.addChild(spot);
spot.lookAt({ x: 0, y: 0, z: 0 });
```

Point lights cast no shadows. For a lamp that casts a shadow, aim a spot light at what the lamp lights.

## Ambient light

An {@link AmbientLight} keeps shadowed sides from going pure black. On its own, it makes shapes look flat, since every side gets the same amount of light.

On a {@link Material3D}, ambient light fades as {@link Material3DOptions#metallic | metallic} rises, so a fully metallic surface, at 1, gets none of it. Light metals with an [environment](./environment.md) instead. A {@link Hemisphere} environment also works as a fill light that doesn't flatten shapes, since it lights surfaces facing up and surfaces facing down in different colours.

## Light limit

A view shades at most {@link MAX_LIGHTS | 32} directional, point and spot lights. Ambient and hidden lights don't count. Past the limit, the view leaves out the visible lights that come last in {@link View3D#lights | view3d.lights}, and gives no warning. That list holds the lights in the order they joined the scene. If you have more than the limit, hide the ones that matter least, such as those far from the camera.

Shadows have a limit of their own, which [the shadow budget](./shadows.md#shadow-map-limit) explains.

## Lights from model files

A glTF file can bring its own directional, point and spot lights; [Loading models](../../assets/__docs__/models.md#file-contents) covers them. When the file has none, {@link View3D.from} adds a {@link DirectionalLight} under the camera. Set its {@link View3DFromOptions#light | light} option to `false` when you add your own lights.

## Next steps

- [Shadows](./shadows.md): casting shadows, their quality, and cascades for large worlds.
- [Environment and IBL](./environment.md): light from the surroundings, tone mapping and exposure.
- [Materials](../../materials/__docs__/materials.md): how surfaces respond to light.
