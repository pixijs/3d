---
title: Compressed models
description: Loading glTF files compressed with meshopt, Draco or mesh quantization, and compressing your own with gltfpack.
category: assets
---

# Compressed models

Three kinds of glTF extension make a model's meshes smaller. Meshopt and Draco compress the file, and {@link loadGltf | the loader} decodes it as it loads. Mesh quantization stores vertex data as small integers, which the GPU reads as they are. PixiJS 3D reads all three, so a compressed file loads with the same `Assets.load` call as any other:

```ts
const source = await Assets.load<Scene3DSource>('fox-meshopt.glb');
```

| Extension                                            | What it makes smaller       | Decoder                                            |
| ---------------------------------------------------- | --------------------------- | -------------------------------------------------- |
| `EXT_meshopt_compression`, `KHR_meshopt_compression` | The download                | Comes with `@pixi/3d`                              |
| `KHR_draco_mesh_compression`                         | The download                | Fetched from Google the first time a file needs it |
| `KHR_mesh_quantization`                              | The download and GPU memory | None                                               |

Quantization works with either of the others. None of the three compresses textures, so a file that's mostly images shrinks little. For files you compress yourself, [gltfpack](#compressing-your-own-models) applies meshopt and quantization in one command, and can compress textures too.

[Compression](/3d/examples?example=assets_compression) loads a different sample model compressed each of these ways.

## meshopt

There's nothing to set up: the loader imports meshopt's decoder the first time a file needs it. Meshopt compresses a file's animation clips as well as its meshes.

## Draco

In [Compression](/3d/examples?example=assets_compression), the walking Cesium Man and the sunglasses are Draco files. The loader fetches the Draco decoder from Google's servers. To host it yourself, such as for an app that works offline, copy the two files at the URLs in {@link dracoDecoderUrls} to your server and pass their new URLs to {@link setDracoDecoderPath}. Call it before the first Draco file loads, since the loader reads the URLs when it first decodes a Draco mesh:

```ts
import { setDracoDecoderPath } from '@pixi/3d';

setDracoDecoderPath({
  jsUrl: '/draco/draco_wasm_wrapper.js',
  wasmUrl: '/draco/draco_decoder.wasm',
});
```

Draco meshes load without their [morph targets](../../animation/__docs__/animation.md#morph-targets), the extra shapes a mesh can blend toward. For a model that has them, run gltfpack on the uncompressed original with [the morph target flags](#compressing-your-own-models), since gltfpack can't read a Draco file.

## Mesh quantization

`KHR_mesh_quantization` stores vertex data, such as positions, normals and texture coordinates, as 8- or 16-bit integers rather than 32-bit floats.

The default hit test, against a mesh's bounding box, works on a quantized mesh too. A [per-triangle hit test](../../events/__docs__/interaction.md#hit-volumes), which finds the triangle under the pointer, never hits a mesh with integer positions ({@link HitVolume3DInput}), and a hit's {@link RaycastHit3D#uv | uv} is a texture coordinate only on a mesh whose texture coordinates are floats. gltfpack can keep either as floats, as [Compressing your own models](#compressing-your-own-models) shows.

When gltfpack quantizes texture coordinates, as it does by default, it adds a texture transform to each textured material, which maps them back onto the texture. The loader sets that as the material's {@link BaseMaterial3D#uvTransform | uvTransform}, so a textured material you build yourself needs the same transform, or it samples the wrong part of the texture. To [give one model](./models.md#a-source-and-its-models) a material of its own, {@link BaseMaterial3D#clone | clone} the file's material, which keeps the transform:

```ts
const blueFox = new Model3D({
  source,
  materials: (material) => material.clone({ baseColor: 0x99aaff }), // tints this fox alone
});
```

## Compressing your own models

[gltfpack](https://meshoptimizer.org/gltf/), from the meshoptimizer project, compresses a glTF or GLB file with meshopt and quantizes it in one command:

```bash
npx gltfpack -i model.glb -o model-packed.glb -cc
```

`-c` compresses with meshopt, and `-cc` compresses further. Quantization is on by default, and `-noq` turns it off. gltfpack also rearranges the file so it draws faster, and that changes what your code finds in it:

- It merges meshes and materials, and drops nodes, the 3D counterpart of 2D containers, that it doesn't need, so a name your code looks up with {@link Container3D#getChildByLabel | getChildByLabel} or {@link Scene3DSource#material | source.material} can disappear. `-kn` keeps named nodes, and `-km` keeps named materials. It drops every mesh and texture name whatever the flags, so {@link Scene3DSource#geometry | source.geometry} and {@link Scene3DSource#texture | source.texture} come back empty: reach a mesh through its node and a texture through its material.
- With integer positions, it can move a mesh to an unnamed child of the node `-kn` keeps, so `getChildByLabel` returns a {@link Container3D} rather than the {@link Mesh3D}. `-vpf` keeps positions as floats and each mesh on its named node. Per-triangle hit tests need it too.
- `-vtf` keeps texture coordinates as floats, for a hit's `uv`.
- The loader skips morph target data stored as integers, so add `-vpf -vnf` for a model that has morph targets.

A model your code reaches into, by name or with per-triangle hit tests, needs a command like this one:

```bash
npx gltfpack -i car.glb -o car-packed.glb -cc -kn -km -vpf
```

`-tc` turns textures into KTX2, which the GPU can keep compressed. The npm build of gltfpack can't do that, so download a native build from its [releases page](https://github.com/zeux/meshoptimizer/releases). Those textures have no PNG or JPEG to fall back on, so the app needs [PixiJS's KTX2 loader](./models.md#extensions). That loader fetches the code that converts KTX2 for the GPU from jsDelivr, unless pixi's `setKTXTranscoderPath` points it elsewhere.

## Next steps

- [Loading models](./models.md): sources, models and what a file can bring.
- [Performance](../../__docs__/concepts/performance.md#checklist-for-phones): what else keeps a scene fast on phones.
