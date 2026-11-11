---
title: Geometry
description: The nine built-in shapes and how a texture lies on them, building a shape from your own vertex arrays, and editing a geometry's vertices.
category: geometry
---

# Geometry

A {@link Geometry3D} holds the points a shape is built from, called vertices, and the triangles that join them. Each vertex has a position. Most also have a normal, the direction the surface faces there, which lighting needs, and UVs, which say what part of a texture lands there. A {@link Mesh3D} draws a geometry with a material, as [Meshes](../../scene/__docs__/meshes.md) covers.

## Built-in shapes

Nine classes build common shapes, normals and UVs included. Sizes are in scene units, not pixels, and +Y points up; [Scene graph and transforms](../../__docs__/concepts/scene-graph.md#axes-units-and-facing) explains why to treat a unit as a metre.

| Geometry                    | Shape                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| {@link PlaneGeometry}       | A flat rectangle standing in the XY plane, facing +Z                                          |
| {@link CubeGeometry}        | A box                                                                                         |
| {@link SphereGeometry}      | A sphere built from rings, with its poles on the Y axis                                       |
| {@link IcosahedronGeometry} | A 20-sided solid                                                                              |
| {@link CylinderGeometry}    | A cylinder along Y; different `radiusTop` and `radiusBottom` make a cone with its tip cut off |
| {@link ConeGeometry}        | A cone along Y, tip up                                                                        |
| {@link CapsuleGeometry}     | A cylinder with rounded ends, along Y                                                         |
| {@link TorusGeometry}       | A ring lying flat in the XZ plane                                                             |
| {@link TorusKnotGeometry}   | A tube wound into a knot around the Y axis                                                    |

A shape is built around its origin, not from its top-left corner as a 2D `Sprite` is by default, so a mesh at y = 0 sinks halfway into a floor at y = 0: raise it by half its height. A capsule's {@link CapsuleGeometryOptions#height | height} is its full length, rounded ends included:

```ts
import { CapsuleGeometry, Material3D, Mesh3D } from '@pixi/3d';

const pill = new Mesh3D({
  geometry: new CapsuleGeometry({ radius: 0.3, height: 1.2 }),
  material: new Material3D({ baseColor: 0x6bc4b8 }),
});

pill.position.y = 0.6; // half its height, so it stands on the floor
view3d.root.addChild(pill);
```

A plane stands upright like a wall; [Scene graph and transforms](../../__docs__/concepts/scene-graph.md#axes-units-and-facing) turns one into a floor. Every shape but the icosahedron takes segment counts, how many slices it's cut into: more make a curved shape smoother and cost more vertices. The icosahedron's {@link IcosahedronGeometryOptions#detail | detail} splits each triangle instead. [Built-in shapes](/3d/examples?example=geometry_shapes) builds each one, and counts its vertices and triangles as you change its options.

## Textures on the built-in shapes

UVs place a texture: `u` runs across the image from left to right, and `v` runs down it from 0 at the image's top row. The shapes lay them out like this:

- {@link PlaneGeometry} and {@link CubeGeometry} put `v = 0` at the bottom edge of the plane and of the cube's sides, so an image shows upside down. Build the plane with {@link PlaneGeometryOptions#flipV | flipV}. The cube has no such option, so flip `v` with its material's {@link BaseMaterial3D#uvTransform | uvTransform}, as the code below does.
- {@link SphereGeometry}, {@link CylinderGeometry}, {@link ConeGeometry} and {@link CapsuleGeometry} put `v = 0` at the top, so an image stands upright, but today it runs around them mirrored, right to left; a `uvTransform` of `new Matrix(-1, 0, 0, 1, 1, 0)` flips it back.
- {@link IcosahedronGeometry} squeezes the whole image into a thin strip along the seam where its `u` wraps around, so use a `SphereGeometry` for a textured ball.
- {@link TorusGeometry} and {@link TorusKnotGeometry} run `u` along the ring or the knot, and `v` around the tube.

```ts
import { Material3D } from '@pixi/3d';
import { Matrix } from 'pixi.js';

const crate = new Material3D({ baseColorTexture: logo, uvTransform: new Matrix(1, 0, 0, -1, 0, 1) }); // v becomes 1 - v
```

A `uvTransform` also repeats a texture across a surface, as a `TilingSprite` does in 2D, once its source's `addressMode` is `'repeat'` ([Tiling and moving textures](../../materials/__docs__/pbr.md#tiling-and-moving-textures)). Setting one replaces the mapping a [sprite-sheet frame](../../materials/__docs__/pbr.md#sprite-sheet-frames) gives the material, so on a frame the flip above shows the whole sheet.

A {@link ContainerTexture}, a texture that shows a 2D container, comes out the other way up from an image: upright on a plane without `flipV` and on a cube, and upside down on the sphere, cylinder, cone and capsule. [Rendering 2D into 3D](../../core/__docs__/container-texture.md) shows how to make one.

## Building your own

Pass arrays to {@link Geometry3D}. {@link Geometry3DOptions#positions | positions} takes three numbers per vertex, and {@link Geometry3DOptions#indices | indices} three vertex numbers per triangle:

```ts
import { Geometry3D, Material3D, Mesh3D } from '@pixi/3d';

// A 1 by 1 floor tile: four corners, two triangles
const tile = new Geometry3D({
  positions: new Float32Array([-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), // every corner faces up
  uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), // the image's top row on the far edge
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]), // counter-clockwise, seen from above
});

view3d.root.addChild(new Mesh3D({ geometry: tile, material: new Material3D({ baseColorTexture: texture }) }));
```

- **Winding.** List each triangle's corners counter-clockwise as seen from the side that should show. Unlike a 2D mesh, a material draws only that side unless it's {@link BaseMaterial3DOptions#doubleSided | double-sided}, so a triangle wound the other way is invisible.
- **Normals.** Without {@link Geometry3DOptions#normals | normals}, every vertex shades as if it faced the mesh's +Z. Faces that share a vertex share its one normal, so they shade smoothly across their edge. For a hard edge, give each face its own copy of the edge's vertices, as `CubeGeometry` does. To facet every triangle, turn on the material's {@link BaseMaterial3DOptions#flatShading | flatShading} instead; it needs no extra vertices.
- **Indices.** Leave them out and the vertices are taken three at a time, in order. A `Uint16Array` holds vertex numbers up to 65,535, so pass a `Uint32Array` for a bigger mesh.

### Lines

With {@link Geometry3DOptions#topology | topology} set to `'line-list'`, each pair of vertices, or of indices, draws a line:

```ts
import { FlatMaterial, Geometry3D, Mesh3D } from '@pixi/3d';

const outline = new Geometry3D({
  positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
  indices: new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]), // the square's four sides
  topology: 'line-list',
});

view3d.root.addChild(new Mesh3D({ geometry: outline, material: new FlatMaterial() }));
```

Lines are one pixel wide on both backends; for a thicker one, build a strip of triangles.

### Vertex colours

{@link Geometry3DOptions#colors | colors} gives each vertex an RGBA colour, and a material multiplies its base colour by them once its {@link BaseMaterial3D#vertexColors | vertexColors} is on. The material reads them in linear light, the scale its lighting maths uses, not as display (sRGB) colours like a hex `baseColor`. So convert a picked colour with {@link srgbToLinear} first, or it comes out too light. This colours a terrain you built with +Y up by its height:

```ts
import { Geometry3D, Material3D, srgbToLinear } from '@pixi/3d';
import { Color } from 'pixi.js';

const [grass, snow] = [0x6a994e, 0xf1f5f9].map((hex) => {
  const color = new Color(hex);

  return [srgbToLinear(color.red), srgbToLinear(color.green), srgbToLinear(color.blue), 1];
});
const colors = new Float32Array(vertexCount * 4);

for (let i = 0; i < vertexCount; i++) colors.set(positions[i * 3 + 1] > 2 ? snow : grass, i * 4);

const geometry = new Geometry3D({ positions, normals, indices, colors });
const material = new Material3D({ vertexColors: true });
```

## Reading vertices back

{@link Geometry3D#normals | geometry.normals} and the other getters return data as it's stored. By default, normals are stored as 16-bit integers, not the floats you passed in, and a model compressed with mesh quantization, which stores vertex data as small integers, can keep its positions and UVs that way too. {@link getAttributeData} reads any of them back as floats:

```ts
import { getAttributeData } from '@pixi/3d';

const normals = getAttributeData(geometry, 'aNormal', 3); // three floats per vertex
```

## Changing a geometry

The first frame a view renders with a mesh that uses the geometry, even a hidden or off-screen mesh, PixiJS 3D copies the geometry's vertices into a buffer it shares with other geometries and draws from that copy. Editing the geometry's arrays afterwards changes nothing on screen, and updating its buffer, as you would a 2D mesh's, doesn't help. Only a dynamic geometry, covered below, draws from its own buffers.

For a different shape, build a new geometry, assign it to {@link Mesh3D#geometry | mesh.geometry}, and {@link Geometry3D#destroy | destroy} the old one once no mesh uses it. Otherwise the old one keeps its space in the shared buffer, which the renderer's garbage collector never frees ([Resources and cleanup](../../__docs__/concepts/resources.md#the-renderers-garbage-collector)).

### Now and then: unload

For an occasional edit, such as raising the ground in a terrain editor, edit the arrays, then call {@link Geometry3D#unload | unload}. The next frame a view renders with a {@link Mesh3D} that uses the geometry copies all of it in again. A {@link BatchedMesh3D} slot that draws the geometry also needs {@link BatchedMesh3D#invalidate | invalidate} for that slot.

```ts
const positions = ground.geometry.positions; // a Float32Array, three numbers per vertex

positions[vertex * 3 + 2] += 0.25; // raise one vertex: a PlaneGeometry laid flat as a floor points its own z up
ground.geometry.unload();
```

Plan for two things when you build a geometry you'll edit this way:

- **Culling bounds.** Culling, which skips meshes outside the camera's view, keeps testing the bounds the geometry was built with, so a mesh can vanish while its edited shape is still on screen. Pass a {@link Geometry3DOptions#bounds3D | bounds3D} box, in the geometry's own axes, big enough for every shape you'll edit it into.
- **Normals.** Moving a vertex changes the slope around it, so the normals there need rewriting too. Build the geometry with {@link Geometry3DOptions#quantizeNormals | quantizeNormals} set to `false`, so `geometry.normals` stays an editable `Float32Array`, three numbers per vertex.

### Every frame: dynamic

For a shape that changes every frame, such as a trail or a rope, build the geometry with {@link Geometry3DOptions#dynamic | dynamic} set to `true`. It draws from its own buffers, so updating one uploads what you wrote. It's never culled, since its vertices can go anywhere.

```ts
import { FlatMaterial, Geometry3D, Mesh3D } from '@pixi/3d';

const ribbon = new Geometry3D({ positions: new Float32Array(32 * 3 * 3), dynamic: true });

// The camera sees a strip from both sides, and it has no normals to light it, so draw it unlit and double-sided
const trail = new Mesh3D({ geometry: ribbon, material: new FlatMaterial({ doubleSided: true }), castShadow: false });

view3d.root.addChild(trail);

app.ticker.add(() => {
  writeRibbon(ribbon.positions); // your code: the x, y and z of three corners per triangle
  ribbon.attributes.aPosition.buffer.update();
});
```
