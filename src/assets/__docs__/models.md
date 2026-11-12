---
title: Loading models
description: Load glTF and GLB files, build models from them, see what a file can bring, and free a file when you're done with it.
category: assets
children:
  - ./compression.md
---

# Loading models

PixiJS 3D loads glTF 2.0, an open file format for 3D models. A model comes either as a `.gltf` file, which is JSON that can point to buffer and image files beside it, or as one binary `.glb` file. Importing `@pixi/3d` registers loaders for both with PixiJS's `Assets`, so a model loads like any other asset:

```ts
import { Model3D } from '@pixi/3d';
import type { Scene3DSource } from '@pixi/3d';
import { Assets } from 'pixi.js';

const source = await Assets.load<Scene3DSource>('car.glb');
const car = new Model3D(source);

view3d.root.addChild(car);
```

Drop a `.glb` file of your own on [Model viewer](/3d/examples?example=start_model-viewer) to see it load.

## A source and its models

`Assets.load` returns a {@link Scene3DSource}, which holds the file's geometry, materials, textures and animation clips. A {@link Model3D} uses the source to build the file's scene as nodes under itself. Nodes are the 3D counterpart of 2D containers. The model, not the source, is what you add to your scene.

Each model builds its own nodes and shares the source's geometry, materials and textures, the way 2D sprites share a texture. A second model loads nothing, so several copies of a prop cost one load:

```ts
const crate = await Assets.load<Scene3DSource>('crate.glb');

for (const x of [-2, 0, 2]) {
  const model = new Model3D(crate);

  model.position.x = x;
  view3d.root.addChild(model);
}
```

For thousands of copies, [Choosing a node for many objects](../../scene/__docs__/scene.md#choosing-a-node-for-many-objects) compares the other ways to draw them.

Because models share materials, changing one changes every model that draws it. Every model built from the source draws the source's materials until you give it materials of its own. {@link Scene3DSource#material | source.material} holds the file's named materials, keyed by name:

```ts
source.material['Paint'].baseColor = 0x3366ff; // tints the paint on every car that draws the source's Paint
```

To change one model alone, give it materials of its own with {@link Model3DOptions#materials | materials}. {@link BaseMaterial3D#clone | clone} copies a material with everything the file gave it, textures included, then sets the options you pass:

```ts
const redCar = new Model3D({
  source,
  materials: { Paint: source.material['Paint'].clone({ baseColor: 0xd81b3c }) },
});
```

A record replaces materials by name, as here. An array replaces them by index into {@link Scene3DSource#materials | source.materials}, and a function runs once for each of them. Assigning {@link Model3D#materials | model.materials} switches the materials of a model that's already built, and assigning `undefined` gives it the source's materials back. Neither the option nor the assignment destroys the materials it replaces, so destroy your copies when you're done with them. [Materials per model](/3d/examples?example=assets_model-materials) dissolves one of three helmets this way.

{@link Model3DOptions} set up a model as it's built. Pass them in place of the source, with the source as `source`. `castShadow` and `receiveShadow` apply to every mesh in it, and {@link Model3DOptions#autoPlay | autoPlay} starts a clip:

```ts
const water = new Model3D({ source: waterSource, castShadow: false, receiveShadow: false });
const fox = new Model3D({ source: foxSource, autoPlay: 'Walk' });
```

A model keeps the size its file was built at. glTF works in metres, but some files ignore that. The fox in [Quick start](../../__docs__/getting-started/quick-start.md#load-a-model) is about 80 units tall. [Measuring and sizing](../../__docs__/concepts/scene-graph.md#measuring-and-sizing) shows how to scale a model to the size you want.

## File contents

**Meshes and materials.** A glTF mesh is made of one or more parts, each with its own material. A mesh with one part becomes a {@link Mesh3D}, and a mesh with several becomes a {@link Container3D} holding one `Mesh3D` per part. Materials load as {@link Material3D}. A material the file marks unlit loads as a {@link FlatMaterial}, which ignores lights.

**Names.** Each node takes its name in the file as its {@link Container3D#label | label}, or `node_<index>` when it has none. A mesh's own name in the file labels nothing. The parts of a mesh with several parts get no name from the file either. To find them, look up the container that holds them by the name of the node the mesh sits on. [Parents and children](../../__docs__/concepts/scene-graph.md#parents-and-children) shows how `getChildByLabel` finds a node by label, and why it can miss the bones a character's mesh bends with. To see what a file holds, {@link Container3D#logHierarchy | logHierarchy} prints the tree to the console:

```ts
car.logHierarchy();
// For Khronos's ToyCar sample, it prints:
// Model3D "Model3D"
//   Mesh3D "ToyCar"
//   Mesh3D "Fabric"
//   Mesh3D "Glass"
//   Camera3D "Camera001"
//   ...
```

**Cameras.** The file's cameras become {@link Camera3D} nodes where the file placed them, listed in {@link Model3D#cameras | model.cameras}. [Switching cameras](../../scene/__docs__/cameras.md#switching-cameras) shows how to draw from one.

**Lights.** The file's lights become {@link DirectionalLight}, {@link PointLight} and {@link SpotLight} nodes. Like lights you make, they cast no shadows until you turn on a directional or spot light's {@link Light#castShadow | castShadow}. Point lights cast none.

**Animation.** When the file has animation clips, the model's {@link Model3D#player | player} plays them. The player is `undefined` when the file has none. [Animation](../../animation/__docs__/animation.md) covers playing them.

## Showing one model on its own

{@link View3D.from} builds a view around a source. The view's root is a {@link Model3D} built from the source, so `view3d.root` is the model:

```ts
import { View3D } from '@pixi/3d';

const view3d = View3D.from(source, { autoResize: true, environment: sky });

app.stage.addChild(view3d);
view3d.root.player?.play('Walk');
```

The view comes ready to draw the model:

- Its camera is the `camera` you pass, or else the file's first camera. A file with none gets a new camera on the model's +Z side, facing it, just far enough back to fit the whole model in view.
- When the file brings no lights, the view adds a {@link DirectionalLight} as a child of the camera, so it lights whatever the camera faces. Pass `light: false` to light the scene yourself.

{@link View3DFromOptions} takes the view's options and the model's, such as `castShadow` and `autoPlay`, in one object.

To let people turn the model, aim an {@link OrbitCamera} at its centre, as [Orbit camera](../../extras/__docs__/camera-controls.md#orbit-camera) shows.

## Extensions

glTF extensions add features to the format. PixiJS 3D reads these:

| Extension                                                                                                                                                | What it brings                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `KHR_materials_clearcoat`, `KHR_materials_sheen`, `KHR_materials_specular`, `KHR_materials_iridescence`, `KHR_materials_anisotropy`, `KHR_materials_ior` | Material features; see [Physical extensions](../../materials/__docs__/physical.md)                 |
| `KHR_materials_transmission`, `KHR_materials_volume`                                                                                                     | Glass; see [Transmission and volume](../../materials/__docs__/physical.md#transmission-and-volume) |
| `KHR_materials_emissive_strength`                                                                                                                        | A stronger glow; see [Glow](../../materials/__docs__/pbr.md#emissive-glow)                         |
| `KHR_materials_unlit`                                                                                                                                    | Materials that ignore lights, as {@link FlatMaterial}                                              |
| `KHR_texture_transform`                                                                                                                                  | Tiled and offset textures, one transform per material                                              |
| `KHR_texture_basisu`, `EXT_texture_avif`, `EXT_texture_webp`                                                                                             | KTX2, AVIF and WebP textures                                                                       |
| `KHR_lights_punctual`                                                                                                                                    | Directional, point and spot lights                                                                 |
| `KHR_node_visibility`                                                                                                                                    | Nodes the file hides start hidden                                                                  |
| `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_meshopt_compression`, `KHR_mesh_quantization`                                              | Compressed geometry; see [Compressed models](./compression.md)                                     |

KTX2 textures, which the GPU can keep compressed, need PixiJS's KTX2 loader. Import it once, before you load the model:

```ts
import 'pixi.js/ktx2';
```

Without it, the {@link loadGltf | loader} uses a texture's other image if it has one. A texture with only a KTX2 image fails the load, and the error names the import.

PixiJS 3D supports no other extension. You may meet these three:

- `EXT_mesh_gpu_instancing` repeats a mesh. Only the original draws, at its node.
- `KHR_materials_pbrSpecularGlossiness` is an older material model. The loader ignores it, so you lose any colours and textures kept in it.
- `KHR_animation_pointer` lets clips animate materials, lights and cameras. A file that uses it doesn't load yet, so leave it out when you export.

## Cleaning up

{@link Model3D#destroy | Destroying a model} stops its clips and takes it out of the scene, but leaves the source, which other models may share. Don't pass it flags that destroy geometry, materials or textures. [Destroying](../../__docs__/concepts/resources.md#destroying) explains why.

To free a file, destroy every model built from it, then unload the file through `Assets`, as you would a 2D texture. Unloading destroys the source's geometry, materials and textures:

```ts
car.destroy({ children: true });
await Assets.unload('car.glb');
```

For a view from `View3D.from`, {@link View3D#destroy | destroy the view} with `children: true`, which destroys its model too. A material you gave a model is yours. Unloading the file leaves it, so destroy it once no model uses it.

A file can keep its images beside it rather than inside it. Those images load through `Assets` by URL, so unloading the file destroys them for anything else that loaded the same image, such as the other models in a kit that share one texture atlas. Unload a kit's files together, once none of its models is drawn.

To free GPU memory for a while but keep the model, take it out of the scene and call {@link Model3D#unload | unload}. Adding it back uploads it again. The call unloads the source's geometry and materials, which every model built from that source shares, so take all of those models out of the scene before the next frame. [Unloading](../../__docs__/concepts/resources.md#unloading) says how much of that memory comes back.

```ts
view3d.root.removeChild(car);
car.unload();
```

## Next steps

- [Compressed models](./compression.md): smaller downloads with meshopt and Draco.
- [Animation](../../animation/__docs__/animation.md): playing and blending the clips a model brings.
- [Environment and IBL](../../scene/__docs__/environment.md): lighting a model from a picture of its surroundings.
