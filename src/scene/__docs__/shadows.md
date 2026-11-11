---
title: Shadows
description: Turning shadows on, which meshes cast and catch them, shadow quality, the shadow box and cascades, spot light shadows, redrawing less often, and fixing shadow artefacts.
category: scene
---

# Shadows

A light that casts shadows draws the meshes that cast them into a shadow map: a depth image of the scene, seen from the light. To shade a surface, the view looks it up in that map to see whether something sits between it and the light. [Shadows](/3d/examples?example=shadows_basics) casts the PixiJS logo's shadow onto a wall, with controls for casting and receiving, the map's size and filter, and the biases.

## Turning shadows on

Set {@link Light#castShadow | castShadow} on a {@link DirectionalLight} or a {@link SpotLight}, the two lights that cast shadows. A mesh you build with `new Mesh3D` casts and receives shadows by {@link Mesh3D.defaultOptions | default}, so the light is all a scene needs. A floor only has to catch shadows, so turn its own off:

```ts
import { CubeGeometry, DirectionalLight, Material3D, Mesh3D, PlaneGeometry } from '@pixi/3d';

const sun = new DirectionalLight({ intensity: 3, castShadow: true });

sun.position.set(-3, 5, 2);
view3d.root.addChild(sun);
sun.lookAt({ x: 0, y: 0, z: 0 });

const floor = new Mesh3D({
  geometry: new PlaneGeometry({ width: 8, height: 8 }),
  material: new Material3D({ baseColor: 0x888888 }),
  castShadow: false,
});

floor.rotation.x = -Math.PI / 2;
view3d.root.addChild(floor);

const cube = new Mesh3D({
  geometry: new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 }),
  material: new Material3D({ baseColor: 0xdd4444 }),
});

cube.position.y = 0.4; // resting on the floor
view3d.root.addChild(cube);
```

A shadow takes away only that light's share. The view's [environment](./environment.md) still lights the shadowed surface, so the brighter the sky, the fainter the shadow. No material draws the shadow alone, so the surface that catches it always draws too.

## Which meshes cast and receive

Turn a mesh's {@link Mesh3D#castShadow | castShadow} off wherever no one sees the shadow, such as on floors, water and small debris, since each caster is drawn again for each shadow map it falls in. A floor that doesn't cast can lose the shadow of something floating above it, which [One box over the scene](#one-box-over-the-scene) fixes.

- A mesh whose material blends (`alphaMode: 'blend'`) or has {@link Material3DOptions#transmission | transmission} casts no shadow.
- {@link Mesh3D#receiveShadow | receiveShadow} shows only on a {@link BaseMaterial3D#lit | lit} material, one that reacts to lights. After changing it at runtime, call {@link Mesh3D#invalidate | invalidate} on the mesh.
- A {@link Model3D} takes both as {@link Model3DOptions#castShadow | options} and gives them to every mesh it builds.
- A {@link Sprite3D} casts no shadow by {@link Sprite3DOptions#castShadow | default} and blends by {@link Sprite3DOptions#alphaMode | default}, so it casts only with `castShadow: true` and an `alphaMode` of `'mask'` or `'opaque'`; [Sprite3D](./sprite3d.md#shadows) explains why.
- A {@link BatchedMesh3D} slot casts only if you ask with {@link BatchedMesh3D#setPassesAt | setPassesAt}, as [Batched meshes](./batched-mesh.md#filling-the-slots) shows.
- A `'mask'` card's shadow doesn't show its holes yet, so turn casting off on cards such as leaves. A {@link PlaneGeometry} doesn't yet cast while its back faces the light, even when {@link BaseMaterial3D#doubleSided | doubleSided}, so for a flat caster the light sees from both sides, use a thin {@link CubeGeometry}.

## Quality and soft edges

Two view settings shape every shadow in the view. {@link View3D#shadowQuality | shadowQuality} sets the size of each shadow map: a bigger map gives sharper edges, and each step up takes four times the memory. {@link View3D#shadowFilter | shadowFilter} sets how soft the edges are. {@link ShadowQuality} and {@link ShadowFilter} list the choices.

You can change `shadowQuality` at any time, since it compiles nothing. The first light in the view to cast a shadow compiles new shaders, and so does a new `shadowFilter` after that. Either can stall a frame, so choose the filter and turn shadows on at start-up, as [How a frame renders](../../__docs__/concepts/rendering.md#when-shaders-compile) explains.

```ts
import { View3D } from '@pixi/3d';

const phone = navigator.maxTouchPoints > 0;

const view3d = new View3D({
  autoResize: true,
  shadowQuality: phone ? 'medium' : 'high',
  shadowFilter: phone ? 'hard' : 'pcf',
});
```

## Directional shadows

A directional light's shadow map covers a box of the world, seen from the light. The map's pixels spread over that box, so the bigger the box, the blurrier every shadow in it.

### One box over the scene

By default, the light fits the box around every visible shadow caster in the scene, on screen or off. That suits a scene that fits in one view, such as a room, an arena or a board. While the scene has 256 casters or fewer, hidden ones included, the light refits the box each time it redraws. Past 256, it fits the box once and keeps it, so call {@link Light#fitShadowBounds | fitShadowBounds} after you move or spawn casters outside it.

The box holds the casters and nothing else, so:

- One distant caster, such as far-off scenery, stretches the box and blurs every shadow. Turn casting off on scenery like that.
- Only surfaces inside the box are sure to get a shadow. The box isn't fitted to a floor with `castShadow: false`, so the shadow of something floating above the floor can vanish, and a low sun's long shadows can stop short.

For a scene like that, give the light a box of your own with {@link LightShadow#bounds | shadow.bounds}, in world coordinates, that takes in the floor where the shadows land:

```ts
import { Box } from '@pixi/3d';

sun.shadow.bounds = Box.fromCenterSize({ x: 0, y: 1, z: 0 }, { x: 14, y: 2.6, z: 14 });
```

### Cascades for large worlds

For a world bigger than the screen, cascades split what the camera sees into slices by distance, each with a shadow map of its own. The near slices cover little ground, so the shadows closest to the camera stay sharp. The light fits the cascades to the camera each time it redraws, so the world can be any size, but they have to keep redrawing while the camera moves. A box doesn't follow the camera, so for scenery that stays still and fits in one box, such as a forest an orbit camera circles, one box with [`update: 'manual'`](#redrawing-less-often) draws its map once however the camera moves. That's the cheapest choice on a phone, though cascades keep the shadows near the camera sharper.

```ts
sun.shadow.cascades = 3;
sun.shadow.maxDistance = 80;
```

- {@link LightShadow#cascades | cascades} is the number of slices, from 1 to 4. More slices keep shadows sharp further from the camera, but the farthest slice stays about as coarse whatever the count. Each one is another map to draw and to fit in the budget below.
- {@link LightShadow#maxDistance | maxDistance} is how far from the camera the cascades reach. Set it to how far away shadows still matter, in your scene's units; a shorter reach makes every cascade sharper.
- {@link LightShadow#lambda | lambda} shares that reach out between the slices; raise it toward 1 for more detail near the camera.

[Large scenes](/3d/examples?example=shadows_large-scenes) switches one sun between a fixed box and one to four cascades over a long road, and draws each map's texels on the road as a grid, so you can see the cascades keep them fine near the camera.

## Spot light shadows

A {@link SpotLight}'s shadow map covers its cone, so it ignores `bounds` and `cascades`. The map starts 1 world unit in front of the light, so a caster closer than that casts no shadow. Keep its {@link SpotLight#coneAngle | coneAngle} under 90 degrees and as narrow as the light allows: the map spreads over the whole cone, so the wider the cone, the coarser the shadow.

## Redrawing less often

Every shadow map redraws every frame by default, even while nothing in it moves. {@link LightShadow#update | shadow.update} slows that down: a number `N` redraws every Nth frame, `'manual'` draws once and then again when you call {@link Light#refreshShadows | refreshShadows}, and with cascades an array gives each cascade its own rate:

```ts
sun.shadow.update = [1, 2, 8]; // the nearest cascade every frame, the farthest every 8th

lamp.shadow.update = 'manual';
// ...later, after the furniture moves:
lamp.refreshShadows();
```

Until a light redraws, its shadow stays as it was drawn, even when a caster moves, the light moves or turns, or, with cascades, the camera moves. A change to its `bounds`, `cascades`, `maxDistance`, `lambda` or `normalBias`, or to a spot light's `coneAngle` or `range`, needs a redraw too. With `'manual'`, also call `refreshShadows` after any light, this one included, starts or stops casting a shadow, such as by being hidden, shown, added or removed, or changes its cascades.

## Fixing shadow acne and floating shadows

A shadow map holds one depth per pixel, so a surface can end up shadowing itself. Two settings, {@link LightShadow#bias | bias} and {@link LightShadow#normalBias | normalBias}, push the lookup off the surface:

- **Shadow acne** is stripes or speckles of shadow across lit surfaces. Raise `bias`, a small depth offset, or `normalBias`, which moves each point out along its normal, the direction its surface faces, before the lookup.
- **Peter-panning** is a shadow that starts a little away from its caster, so the caster seems to float. Too much bias causes it, so lower what you raised.

Leave both at their defaults until you see one of these. In [Shadows](/3d/examples?example=shadows_basics), setting both to 0 shows acne, and a `bias` of 0.02 or more lifts the ball's shadow away from it.

## The shadow budget

Shadows from all of a view's {@link Light | lights} share 16 shadow maps. Each spot light and each directional light without cascades takes one, and a cascaded light takes one per cascade. Lights take maps in the order they joined the scene, and a hidden light takes none. A light that doesn't fit still lights the scene, but without its shadow, and a warning says so.

## Next steps

- [Lights](./lights.md): the kinds of light, and how many a view draws.
- [Performance](../../__docs__/concepts/performance.md#checklist-for-phones): the shadow settings that matter most on phones.
- [Batched meshes](./batched-mesh.md#shadows): shadow casters by the thousand.
