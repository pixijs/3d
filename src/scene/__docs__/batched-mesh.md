---
title: Batched meshes
description: Drawing thousands of meshes from one BatchedMesh3D node, with its slots, matrices, hidden spares, camera-facing cards, culling and cleanup.
category: scene
---

# Batched meshes

A {@link BatchedMesh3D} draws many meshes from one scene node. Each mesh is a slot: a geometry, a material and a matrix that places it, with no {@link Mesh3D} of its own. [Choosing a node for many objects](./scene.md#choosing-a-node-for-many-objects) says when to pick it over meshes, sprites or particles. A slot is rigid: it can't bend with bones or morph targets, so animated characters stay {@link Model3D}s.

[BatchedMesh3D](/3d/examples?example=instancing_batched-mesh) draws a ring of up to 100,000 clay shapes from one batch.

## Filling the slots

The number of slots is fixed when you create the batch, so size it for the most meshes you'll show at once. A frame draws in steps called [passes](../../__docs__/concepts/rendering.md#the-passes-in-a-frame), such as shadows and then solid meshes. Give each slot a geometry, a material and a matrix, and put it in the passes that draw it:

```ts
import { BatchedMesh3D, ConeGeometry, Material3D, Matrix4, Quaternion, RenderPassBit, Vector3 } from '@pixi/3d';

const COUNT = 2000;
const forest = new BatchedMesh3D({ size: COUNT });
const cone = new ConeGeometry({ radius: 0.6, height: 2, radialSegments: 8 }); // few sides, since it draws 2,000 times
const pine = new Material3D({ baseColor: 0x2f6b3a, roughness: 0.9 });

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const scale = new Vector3();

for (let i = 0; i < COUNT; i++) {
  const size = 0.7 + Math.random() * 0.6;

  // A tree somewhere in a 200 x 200 square, standing on the ground, turned at random
  position.set((Math.random() - 0.5) * 200, size, (Math.random() - 0.5) * 200);
  rotation.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.random() * Math.PI * 2);
  scale.set(size);

  forest.setGeometryAt(i, cone);
  forest.setMaterialAt(i, pine);
  forest.setMatrixAt(i, matrix.compose(position, rotation, scale));
  forest.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
}

view3d.root.addChild(forest);
```

- **A slot doesn't take its passes from its material**, as a mesh does. Give it {@link RenderPassBit} flags with {@link BatchedMesh3D#setPassesAt | setPassesAt} to match the material, such as `OPAQUE` for an {@link BaseMaterial3D#alphaMode | alphaMode} of `'opaque'` or `'mask'`, `TRANSPARENT` for `'blend'`, and `TRANSMISSION` instead for a {@link Material3D} with {@link Material3DOptions#transmission | transmission}. Add `SHADOW` to cast shadows. No flag joins a [mesh pass](../../post-processing/__docs__/post-processing.md#mesh-passes), such as an outline, so a slot can't have one.
- **A slot in a pass needs a geometry and a material**, even while it's hidden. Spare slots in no pass can stay empty.
- **A new slot's matrix is all zeros**, so it draws nothing until you set one. The matrix places the slot relative to the `BatchedMesh3D`, and {@link Matrix4#compose | compose} builds one from a position, a rotation and a scale.
- **An object made of parts**, such as a trunk and a crown, takes a slot per part, so count parts when you size the batch. A part's matrix is the object's matrix times the part's offset on the object: {@link Matrix4#multiply | tree.multiply(offset, part)} writes it into `part`, and the part turns and scales with the tree.
- **Moving, turning or hiding the `BatchedMesh3D`** does the same to every slot at once. On WebGPU, though, `'blend'` slots can overlap in the wrong order once the batch or a parent moves, turns or scales, so leave a batch of them at the origin, unturned and unscaled, and place the slots with their matrices.

Slots can mix geometries and materials, and share draw calls by the same rules as meshes; [What makes a draw call](../../__docs__/concepts/performance.md#what-makes-a-draw-call) has them. A slot has no `tint` like a 2D sprite's, and changing a material changes every slot that uses it. To recolour one slot, give it another material with {@link BatchedMesh3D#setMaterialAt | setMaterialAt}, which on WebGPU costs a draw call per material, or give it [a value of your own](#values-of-your-own-per-slot), which keeps one call.

## Moving slots

{@link BatchedMesh3D#setMatrixAt | setMatrixAt} copies a matrix into the slot and allocates nothing, so it's fine to call for every slot every frame.

To move thousands of slots a frame, skip the copy and write into the batch's own array, {@link BatchedMesh3D#matrices | matrices}. Slot `i`'s matrix is the 16 numbers from `offset + i * stride`, stored column by column: numbers 12, 13 and 14 hold its position, and 0 to 2, 4 to 6 and 8 to 10 its rotation and scale. Then call {@link BatchMatrices#update | update()} once, or the GPU may never see what you wrote. This swirls a galaxy of slots round the origin, the inner ones faster:

```ts
app.ticker.add((ticker) => {
  time += ticker.deltaMS / 1000;

  const { data, stride, offset } = galaxy.matrices;

  for (let i = 0, o = offset; i < galaxy.size; i++, o += stride) {
    const angle = angles[i] - (time * 3) / (radii[i] + 2); // inner spheres orbit faster

    data[o + 12] = Math.cos(angle) * radii[i];
    data[o + 14] = Math.sin(angle) * radii[i];
  }

  galaxy.matrices.update();
});
```

- Set each slot's whole matrix once, with `setMatrixAt` or here, before you write only the numbers that move.
- Write only a slot's 16 numbers; the numbers after them hold engine data.

[BatchedMesh3D](/3d/examples?example=instancing_batched-mesh) lifts slots this way, then marks only those it wrote with `update(first, count)`.

## Showing and hiding slots

{@link BatchedMesh3D#setVisibleAt | setVisibleAt} hides or shows a slot, as `visible` does for a mesh. A hidden slot draws nothing, shadow included, and keeps its geometry, material, matrix and passes, so showing it again rebuilds nothing, which makes it the way to spawn and despawn. Every slot starts visible, so hide the spares first:

```ts
const bullets = new BatchedMesh3D({ size: 200, parent: view3d.root });

for (let i = 0; i < bullets.size; i++) {
  bullets.setGeometryAt(i, bulletGeometry);
  bullets.setMaterialAt(i, bulletMaterial);
  bullets.setPassesAt(i, RenderPassBit.OPAQUE);
  bullets.setVisibleAt(i, false); // a spare until fire() uses it
}

function fire(muzzle: Matrix4): void {
  for (let i = 0; i < bullets.size; i++) {
    if (bullets.getVisibleAt(i)) continue; // in flight

    bullets.setMatrixAt(i, muzzle);
    bullets.setVisibleAt(i, true);

    return;
  }
}
```

Hidden blended slots still cost a sort every frame; {@link BatchedMesh3D#setVisibleAt | setVisibleAt} says when to take a spare out of its pass with `setPassesAt(i, 0)` instead.

## Changing what a slot draws

{@link BatchedMesh3D#setMaterialAt | setMaterialAt} and {@link BatchedMesh3D#setGeometryAt | setGeometryAt} swap what a slot draws with. The slot keeps its passes, so when the new material needs others, such as a `'blend'` material replacing an `'opaque'` one, call {@link BatchedMesh3D#setPassesAt | setPassesAt} too. When you change a material that slots already use, values such as `baseColor` show by themselves. After a texture swap, though, call {@link BatchedMesh3D#invalidate | invalidate} for each slot that uses the material, or they keep the old texture. `invalidate` lists the other changes that need it.

```ts
leaves.textures.baseColor = autumnLeaves;

for (const i of leafSlots) trees.invalidate(i);
```

A slot's {@link BatchedMesh3DSlot#billboardMode | billboardMode} and {@link BatchedMesh3DSlot#receiveShadow | receiveShadow} live in {@link BatchedMesh3D#items | items}, and a change to either also needs `invalidate`.

## Values of your own per slot

For a value that changes per slot, such as a tint that fades every frame, declare a field with the {@link BatchedMesh3DOptions#instanceData | instanceData} option. A shader bit, a piece of shader code you add to the material with {@link BaseMaterial3DOptions#extraBits | extraBits}, reads it as `instance.<name>`; [Adding your own shader code](../../extras/__docs__/custom-materials.md#adding-your-own-shader-code) explains bits.

```ts
import { BatchedMesh3D, Material3D } from '@pixi/3d';
import type { ShaderBit } from '@pixi/3d';

const tintBit: ShaderBit = {
  name: 'slotTint',
  bindings: { instance: { tint: 'vec4<f32>' } },
  gpu: { fragment: { material: 'albedo *= instance.tint.rgb;' } },
  gl: { fragment: { material: 'albedo *= instance.tint.rgb;' } },
};

const boxes = new BatchedMesh3D({ size: 1000, instanceData: { tint: { value: [1, 1, 1, 1], type: 'vec4<f32>' } } });
const paint = new Material3D({ baseColor: 0xffffff, extraBits: [tintBit] });

// Fill the slots with paint, as the forest above does, then:
boxes.setInstanceDataAt(0, 'tint', 1, 0.2, 0.2, 1); // slot 0 turns red
```

{@link BatchedMesh3D#setInstanceDataAt | setInstanceDataAt} writes one slot. To write many a frame, {@link BatchedMesh3D#instanceData | instanceData} gives the array the same way `matrices` does, with its own `update()`.

## Cards that face the camera

A slot with {@link PlaneGeometry.spriteQuad} and a `billboardMode` is a card that turns to face the camera. The matrix's x and y scale set the card's width and height:

```ts
import { Matrix4, PlaneGeometry, RenderPassBit } from '@pixi/3d';

const card = new Matrix4();

grass.setGeometryAt(i, PlaneGeometry.spriteQuad);
grass.setMaterialAt(i, bladeMaterial);
// 0.4 wide and 0.8 tall, standing on the ground
grass.setMatrixAt(i, card.makeScale(0.4, 0.8, 1).setPosition({ x, y: 0.4, z }));
grass.setPassesAt(i, RenderPassBit.OPAQUE); // no SHADOW: a light draws a card's shadow from the unturned card
grass.items[i].billboardMode = 'cylindrical'; // turns about its upright axis only, so it stays standing
grass.invalidate(i);
```

## Culling

Culling skips what's outside the camera's view. A batch culls by its own {@link BatchedMesh3D#cull | cull}, not the view's {@link View3D#cull | cull}, and it's `'off'` by default, so every slot in a pass draws, on screen or not. Turn it on for a large batch that spreads well beyond the view, such as scenery across a whole map:

```ts
const forest = new BatchedMesh3D({ size: 10_000, cull: 'gpu' });
```

Once it's on, the batch tests its slots every frame, and again for each shadow map that redraws. Where the test [runs on the CPU](../../__docs__/concepts/webgl-and-webgpu.md#how-each-renderer-culls), as under WebGL2, that work grows with the slot count; on the GPU, the CPU barely notices it. With the whole batch in view, the test still runs but culls nothing, so for a camera that zooms out to see all of it, culling only saves work while zoomed in. {@link CullMode} says when each mode suits.

## Shadows

A slot in the `SHADOW` pass counts as a shadow caster, even while it's hidden. By default, a directional light refits its shadow box, the part of the world its shadows cover, only while the scene has few casters, so with a large batch it fits the box once and keeps it; see [One box over the scene](./shadows.md#one-box-over-the-scene). After you move or spawn slots outside the box, call {@link Light#fitShadowBounds | fitShadowBounds}, or set your own box with {@link LightShadow#bounds | shadow.bounds}.

## Cleaning up

{@link BatchedMesh3D#destroy | destroy} frees the batch's own buffers but leaves the slots' geometries and materials, which are often shared, unless you pass `geometry` or `material`, or `true`, which sets every flag. It then destroys each one once, however many slots use it:

```ts
forest.destroy({ geometry: true, material: true });
```

{@link BatchedMesh3D#unload | unload} is for a batch you'll show again later; [Unloading](../../__docs__/concepts/resources.md#unloading) says what it frees.

## Next steps

- [Performance](../../__docs__/concepts/performance.md): what puts meshes in one draw call, and keeping a scene fast on phones.
- [Sprite3D](./sprite3d.md): cards with a sprite's API, for hundreds to a few thousand.
- [Particles](../../extras/__docs__/particles.md): effects that emit, move and fade on their own.
