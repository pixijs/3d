---
title: Physical extensions
description: Clearcoat, sheen, specular, index of refraction, iridescence, glass and anisotropy on Material3D, how glass draws, and what each feature costs.
category: materials
---

# Physical extensions

Beyond base colour, metalness and roughness, {@link Material3D} takes the glTF material extensions in the table below. A glTF model whose file uses one of them loads with the matching option set.

Each of these features is an option group. Passing the group turns the feature on, even when it's empty: `clearcoat: {}` adds a full-strength, mirror-smooth coat. The material then has a property of the same name, such as `material.clearcoat`, for changing the group's values; it's `undefined` on a material built without the group.

```ts
const paint = new Material3D({ baseColor: 0x8c1c13, roughness: 0.5, clearcoat: {} });

paint.clearcoat!.roughness = 0.1;
```

Which groups a material has is fixed when you create it, as [Materials](./materials.md#whats-fixed-when-you-create-a-material) explains.

| Group          | glTF extension                                       | What it adds                                      |
| -------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `clearcoat`    | `KHR_materials_clearcoat`                            | A clear lacquer layer with its own highlight      |
| `sheen`        | `KHR_materials_sheen`                                | A soft glow at the edges, as on cloth             |
| `specular`     | `KHR_materials_specular`                             | The strength and tint of a non-metal's reflection |
| `iridescence`  | `KHR_materials_iridescence`                          | Colour that shifts with the viewing angle         |
| `transmission` | `KHR_materials_transmission`, `KHR_materials_volume` | Glass and other surfaces you see through          |
| `anisotropy`   | `KHR_materials_anisotropy`                           | Highlights stretched in one direction             |

`ior`, from `KHR_materials_ior`, is a plain option rather than a group. [PBR materials](./pbr.md#glow) covers the `emissive` group.

## Clearcoat

A {@link ClearcoatOptions | clearcoat} is a clear layer over the surface, as on car paint or varnished wood. The coat has its own roughness and highlight and reflects the view's [environment](../../scene/__docs__/environment.md), so rough paint can carry a sharp reflection on top.

```ts
const carPaint = new Material3D({ baseColor: 0x8c1c13, roughness: 0.5, clearcoat: { roughness: 0.03 } });
```

The coat ignores the material's `normalTexture`. For bumps in the coat, such as the orange peel of sprayed lacquer, give it its own {@link ClearcoatOptions#normalTexture | normalTexture} when you create the material.

[Clearcoat](/3d/examples?example=materials_clearcoat) sets a coated sphere beside a bare one in the same paint.

## Sheen

{@link SheenOptions | Sheen} is the soft glow on velvet, satin and other cloth. It gathers at the edges of a shape, where you see the surface at a grazing angle.

```ts
const velvet = new Material3D({ baseColor: 0x3b0a45, roughness: 0.9, sheen: { color: 0xd8a0ff, roughness: 0.8 } });
```

{@link SheenOptions#roughness | roughness} sets how far the glow spreads: a low value keeps it to a thin rim, as on satin, and a high one spreads it across the surface, as on velvet.

[Sheen](/3d/examples?example=materials_sheen) dresses the PixiJS logo in velvet. In front of it, two velvet spheres differ only in the sheen: one has a pale rim all round its outline, and the other darkens to its edge.

## Specular

The {@link SpecularOptions | specular} group sets the strength and tint of a non-metal's reflection. `factor` runs from 0, no reflection, to 1, the reflection the material has without the group, and `color` tints it. Metals reflect with their base colour, and the group leaves them alone.

```ts
const dimmed = new Material3D({ baseColor: 0x111114, roughness: 0.05, specular: { factor: 0.25 } });
const warm = new Material3D({ baseColor: 0x111114, roughness: 0.05, specular: { color: 0xff6030 } });
```

[Specular and IOR](/3d/examples?example=materials_specular-ior) changes the group's `factor` and `color` on glossy black plastic, where the reflection is all that shows.

## Index of refraction

{@link Material3D#ior | ior}, the index of refraction, is how strongly a material bends light that passes into it. It also sets how much a non-metal reflects when you look at it head-on. The default, 1.5, suits glass and most plastics. Water is 1.33 and reflects less; diamond is about 2.4 and reflects more. It doesn't change how a metal reflects.

```ts
const water = new Material3D({ baseColor: 0xd8f0ff, roughness: 0.05, ior: 1.33, transmission: { thickness: 1 } });
```

In [Specular and IOR](/3d/examples?example=materials_specular-ior), five spheres of glossy black plastic run from an `ior` of 1, which reflects nothing head-on, to diamond's 2.42.

## Iridescence

{@link IridescenceOptions | Iridescence} is a thin film on the surface, as on a soap bubble, an oil slick or a beetle's shell. The film colours the surface's reflections and highlights, and the colour shifts with the angle you see it from.

```ts
const beetle = new Material3D({
  baseColor: 0x112211,
  metallic: 1,
  roughness: 0.2,
  iridescence: { thicknessMaximum: 500 },
});
```

The film's thickness, in nanometres, picks its colours. Without a texture, {@link IridescenceOptions#thicknessMaximum | thicknessMaximum} sets it.

## Transmission and volume

The {@link TransmissionOptions | transmission} group lets light through the surface, for glass, water, gems and clear plastic. Where `alphaMode: 'blend'` fades a surface, transmission bends what's behind it by the material's `ior`, blurs it on rough glass and tints it with the base colour.

```ts
const glass = new Material3D({ roughness: 0.05, transmission: { thickness: 0.5 } });
```

On WebGL2, glass can also need the application's `useBackBuffer` option; [How glass draws](#how-glass-draws) says when.

{@link TransmissionOptions#thickness | thickness} is how far light travels inside the object, in the mesh's own units, so it scales with the mesh. At 0, the default, the surface is a thin wall, such as a window pane, and what's behind it shows through without bending. Give a solid object a thickness close to its own size. The volume can also tint the light passing through it, as wine does, and that needs a thickness above 0 too:

```ts
const wine = new Material3D({
  roughness: 0,
  transmission: { thickness: 1, attenuationDistance: 1, attenuationColor: 0x7a0f1e },
});
```

[Glass and liquids](/3d/examples?example=materials_transmission) bends a fence of bars through a glass logo and tints them through a bottle of liquid.

### How glass draws

After the opaque meshes, the view copies the picture so far, then draws the glass over it. What's in the copy decides what you see through glass:

- **The background, the opaque meshes**, what `'afterOpaque'` items in {@link View3D#passes | view3d.passes} draw into the scene and, in a view drawn straight to the screen, the 2D content drawn before the view, as [Glass over 2D](/3d/examples?example=2d3d_glass-over-2d) shows.
- **Not other glass.** Glass behind glass doesn't show through it.
- **Not blended meshes**, which include {@link Sprite3DOptions#alphaMode | sprites} and {@link ParticleContainer3DOptions#alphaMode | particles} by default. Glass also hides them where they're behind it. To see sprites or particles through glass, give them an {@link AlphaMode | alphaMode} of `'mask'`, which draws them hard-edged with the opaque meshes. Building the glass with `alphaMode: 'blend'` doesn't help: they then draw on top of the glass, unbent.

A {@link Mesh3D} whose material has transmission casts no shadow, even with {@link Mesh3D#castShadow | castShadow} on.

In [composite mode](../../__docs__/concepts/view3d.md#resolution-and-composite-mode), such as while a post effect is on, the view draws into a texture of its own, so its glass shows only the view's own 3D. Put what should show through the glass in the scene; for 2D content, draw it onto a 3D surface as [Rendering 2D into 3D](../../core/__docs__/container-texture.md) shows.

> [!WARNING]
> On WebGL2, glass in a view drawn straight onto an opaque canvas, PixiJS's default, shows nothing through it and looks black apart from its reflections. Start the application with `useBackBuffer: true` to fix it. WebGPU doesn't need it.

```ts
await app.init({ preference: 'webgpu', useBackBuffer: true });
```

On WebGL2 the option costs an extra full-screen draw every frame. It also breaks the lighting of {@link BaseMaterial3DOptions#doubleSided | doubleSided} materials, so in an app that has them, leave it off and give the view {@link View3DOptions#composite | composite: true} instead: glass in composite mode works without it.

## Anisotropy

{@link AnisotropyOptions | Anisotropy} stretches highlights along one direction, as on brushed metal, a vinyl record or hair.

```ts
const brushed = new Material3D({ baseColor: 0xb0b0b0, metallic: 1, roughness: 0.4, anisotropy: { strength: 0.8 } });
```

The stretch runs along the surface's tangent, a direction lying in the surface, taken from the geometry's tangents when it has them and otherwise from its UVs, the texture coordinates. {@link AnisotropyOptions#rotation | rotation} turns it. For a direction that varies across the surface, such as the circles on a record, give the group a {@link AnisotropyOptions#texture | texture} when you create the material.

## What each feature costs

Each group adds work to every pixel the material covers. The cost comes with the group, not its values: a `clearcoat` with a `factor` of 0 looks the same as no coat and costs as much as a full one. Each texture slot a group adds, listed in {@link Material3DTextures}, counts toward the texture limit that [Materials](./materials.md#textures) describes, whether or not you fill it.

| Group          | Extra work per pixel                                       |
| -------------- | ---------------------------------------------------------- |
| `specular`     | A few instructions                                         |
| `iridescence`  | A thin-film colour calculation                             |
| `clearcoat`    | A second highlight for each light, and a second reflection |
| `sheen`        | A sheen highlight for each light, and a reflection         |
| `anisotropy`   | A second highlight calculation for each light              |
| `transmission` | A read of the copy of the picture                          |

Glass also costs the copy itself, every frame that glass is in the scene, as [How a frame renders](../../__docs__/concepts/rendering.md#the-passes-in-a-frame) explains.

## Next steps

- [Environment and IBL](../../scene/__docs__/environment.md): the reflections that clearcoat, sheen and glass show.
- [Loading models](../../assets/__docs__/models.md): models whose files use these extensions.
