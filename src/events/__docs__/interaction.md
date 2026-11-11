---
title: Interaction
description: Pointer events on 3D objects, hit volumes, propagation, dragging and picking without events.
category: events
---

# Interaction

3D nodes, the counterpart of 2D containers, take PixiJS's own pointer events. Set a node's {@link Container3D#eventMode | eventMode} and listen on it as you would on a 2D container, with the same event names, capture and bubble phases and `cursor`.

```ts
const button = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0x3399ff }) });
view3d.root.addChild(button);

button.eventMode = 'static';
button.cursor = 'pointer';
button.on('pointertap', () => console.log('clicked the cube'));
```

To PixiJS, a {@link View3D} is one 2D object. When the pointer is over it, the view casts a ray, a line from the camera through the pointer, into the scene. It finds the closest node the ray hits, which is called picking, and sends the event to it through its 3D parents.

[Pointer events](/3d/examples?example=interaction_pointer-events) shows hover, taps and the mouse wheel on 3D shapes.

## Which nodes take part

`eventMode` takes the same values as in 2D, and every 3D node starts as `'passive'`:

- `'static'`: the node is hit-tested and fires its listeners.
- `'dynamic'`: as `'static'`, and the view tests again under a still mouse or pen, so a node that moves under the pointer gets its enter and leave events.
- `'passive'`: the node fires no listeners. Under an interactive ancestor it is still hit-tested, and the hit goes to that ancestor, so setting a model or group to `'static'` makes every mesh in it clickable.
- `'none'`: the node and everything under it are left out.

The renderer's `eventMode` option sets the default only for 2D containers, so 3D nodes stay `'passive'` until you set them. Each pick tests every node that takes part, so set the mode only on the nodes and groups that need it.

## Hit volumes

A node is hit-tested against its {@link Container3D#hitVolume | hitVolume}, the 3D version of `hitArea`. Left unset, a {@link Mesh3D} uses its geometry's bounding box, the smallest box that holds all its vertices. A plain {@link Container3D} has no shape of its own, so it only hears events through its children.

```ts
mesh.hitVolume = 'box'; // the bounding box, the default for a mesh
mesh.hitVolume = 'geometry'; // every triangle
mesh.hitVolume = new Sphere(new Vector3(0, 0, 0), 0.5); // a shape you choose, in the node's own space
mesh.hitVolume = new CapsuleGeometry(); // a simpler stand-in mesh, tested per triangle
```

- The bounding box is cheap, but around a round object its empty corners count as hits.
- `'geometry'` is exact, but its cost grows with the triangle count.
- A {@link Box} or {@link Sphere} you make can fit the object better, and is as cheap to test as the bounding box.

[Hit volumes](/3d/examples?example=interaction_hit-volumes) outlines each shape's volume and lets you switch it.

Per-triangle tests only work on ordinary triangle meshes with float positions. A model whose positions gltfpack [quantized](../../assets/__docs__/compression.md#mesh-quantization) to integers, as it does by default, never hits that way, so give it the bounding box or a stand-in. {@link HitVolume3DInput} lists the other limits.

Picking reads a mesh's vertices as stored, so skinning and morph targets, the ways a model changes shape as it animates, move neither what the ray hits nor the default bounding box. Give an animated character a `Box` or `Sphere` that covers its moves.

A {@link Sprite3D}, like any mesh whose {@link Mesh3D#billboardMode | billboardMode} isn't `'none'`, turns to face the camera only as it's drawn, so it's picked as its unturned quad, which thins to an edge from the side. Give it a `Sphere` too. For a `Sprite3D`, put the sphere on a group that holds the sprite, set the group's `interactiveChildren` to `false` as below, and listen on the group: a sphere on the sprite itself comes out squashed or stretched.

Setting {@link Container3D#interactiveChildren | interactiveChildren} to `false` takes everything below a node out of picking, and the node picks by its own hit volume alone. One box on a group can then answer for all of it, with one test instead of one per mesh:

```ts
target.eventMode = 'static';
target.hitVolume = 'box'; // on a group, measured around its children once, when set
target.interactiveChildren = false;
```

## The 3D event

A pointer listener on a 3D node gets a {@link Pointer3DEvent}, PixiJS's own event object with three {@link Event3DFields} added:

- {@link Event3DFields#hit3D | hit3D}: what the ray hit, as a {@link RaycastHit3D}, or `null` on a miss. Its `point` is in world space, the scene's own coordinates. Per-triangle hits also carry the `normal`, the direction the surface faces, and `uv`, the texture coordinate under the pointer; box and sphere hits report zeros for both. On a model whose texture coordinates are [quantized](../../assets/__docs__/compression.md#mesh-quantization), stored as integers, {@link RaycastHit3D#uv | uv} holds the hit's place in its triangle instead, so the painting below doesn't work there.
- {@link Event3DFields#target3D | target3D}: the 3D node the event is about, usually the one the ray hit or, when that node is `'passive'`, its nearest interactive ancestor. To know which mesh of a model was hit, set the meshes to `'static'` too and listen on the model: `target3D` is then the mesh.
- {@link Event3DFields#currentTarget3D | currentTarget3D}: the node whose listeners are running now.

With `uv`, painting on a mesh takes a few lines. Here the mesh shows a canvas as its texture, and each move with a button or finger down draws into it:

```ts
easel.eventMode = 'static';
easel.hitVolume = 'geometry';
easel.on('pointermove', (e) => {
  if (!e.hit3D || !e.buttons) return;
  context.fillRect(e.hit3D.uv.x * canvas.width, e.hit3D.uv.y * canvas.height, 8, 8);
  texture.source.update();
});
```

[Painting on a mesh](/3d/examples?example=interaction_paint) paints a ball this way, sending the canvas to the GPU at most once a frame rather than on every move.

PixiJS reuses event objects, so `hit3D` and its vectors change with the next event. Copy what you keep, as in `saved.copyFrom(e.hit3D.point)`.

## Propagation

An event travels through the 3D hierarchy as through the 2D one: capture listeners such as `pointerdowncapture` run on the way down, and plain listeners on the way back up. As in 2D, an `on*` handler property runs in every phase that reaches the node, so a parent's `onpointerdown` runs twice per event.

[Event propagation](/3d/examples?example=interaction_event-flow) logs each stop a press makes through a table, a tray and the shapes on it, and lets you pick the listener that calls `stopPropagation()`.

`stopPropagation()` stops the event at the current node, and the view's plain `on()` listeners don't hear it either. An {@link OrbitCamera} listens on the view, so this keeps a drag on an object from turning the camera, as [Dragging](#dragging) shows.

Plain `view3d.on()` listeners run after the 3D listeners and can read the 3D fields, with `target3D` set to `null` on empty space. The view takes pointer events by default, so you needn't set its `eventMode`.

## Clicks, hover and cursors

These work as in 2D:

- A press and release on the same node is a tap however far the pointer moved. So a drag that orbits the camera and ends on the view taps the view, and taps the model too when it started and ended on one.
- A hovered node that you remove from the scene, or set to `'passive'` or `'none'`, gets no `pointerout` or `pointerleave`. Reset its hover look when you remove or disable it.

To act only on real clicks, ignore a tap that ends more than a few pixels from where it was pressed. These listeners on the view do that, and select what was clicked, or nothing on empty space:

```ts
const pressedAt = new Point();

view3d.on('pointerdowncapture', (e) => pressedAt.copyFrom(e.global)); // runs even when a 3D listener stops the press
view3d.on('pointertap', (e) => {
  if (Math.hypot(e.global.x - pressedAt.x, e.global.y - pressedAt.y) > 8) return; // the camera was dragged
  select(e.target3D); // null on empty space
});
```

Only the target's {@link Container3D#cursor | cursor} counts, so set it on the node that becomes `target3D`, even when your listener is on the view. Over empty space, and over a target with none, the view's own {@link IView3DEvents#cursor | cursor} shows.

A {@link Mesh3D} takes its colour from its material, so show hover and selection there: [swap materials](../../scene/__docs__/meshes.md#swapping-geometry-and-material), set `baseColor` on a material only that mesh uses, or [outline it](../../extras/__docs__/custom-materials.md#outlines). A model's meshes share their materials with every model built from the same file, so setting `baseColor` on one of those shows on every model. To highlight one of its meshes, make a copy once with {@link BaseMaterial3D#clone | clone}, such as `mesh.material.clone({ baseColor: 0xffe08a })`, which keeps the mesh's textures, and swap to it and back.

## Dragging

A drag has to keep going after the pointer leaves the object, so listen for `globalpointermove`, which fires on every move anywhere on the page. Add it when the drag starts, and remove it on both `pointerup` and `pointerupoutside`, which the node you pressed gets when you release anywhere else. Each finger on a touch screen is its own pointer, so compare `pointerId` to keep two drags apart.

`e.global` is still the pointer's 2D position. To slide an object across the floor, find where the pointer's ray meets the floor's {@link Plane} with {@link View3D#screenToWorld | screenToWorld}, and keep the crate's offset from where it was grabbed:

```ts
const floor = new Plane(new Vector3(0, 1, 0), 0);
const point = new Vector3();

crate.eventMode = 'static';
crate.on('pointerdown', (e) => {
  e.stopPropagation(); // an orbit camera on the view never sees this press
  if (!view3d.screenToWorld(e.global, floor, point)) return;
  const id = e.pointerId; // e is reused, so copy what the listeners below need
  const dx = crate.position.x - point.x;
  const dz = crate.position.z - point.z;

  const onMove = (move: Pointer3DEvent): void => {
    if (move.pointerId === id && view3d.screenToWorld(move.global, floor, point)) {
      crate.position.set(point.x + dx, crate.position.y, point.z + dz);
    }
  };
  const onEnd = (end: Pointer3DEvent): void => {
    if (end.pointerId !== id) return;
    crate.off('globalpointermove', onMove);
    crate.off('pointerup', onEnd);
    crate.off('pointerupoutside', onEnd);
  };

  crate.on('globalpointermove', onMove);
  crate.on('pointerup', onEnd);
  crate.on('pointerupoutside', onEnd);
});
```

[Dragging objects](/3d/examples?example=interaction_drag) drags shapes on a level plane through the point you grab.

## Picking without events

{@link View3D#raycast | raycast} casts the same ray through any point in global coordinates and returns the closest hit, without an event. Use it where no pointer event gives you the point, such as aiming from the middle of the screen in a first-person game. Pass a hit from {@link createRaycastHit3D} for it to fill, so a pick on every frame makes no garbage:

```ts
const aim = createRaycastHit3D();
const middle = { x: 0, y: 0 };

app.ticker.add(() => {
  middle.x = app.screen.width / 2;
  middle.y = app.screen.height / 2;
  crosshair.tint = view3d.raycast(middle, aim) ? 0xff4444 : 0xffffff;
});
```

On a hit, {@link RaycastHit3D#target | aim.target} is the node, as `target3D` is on an event. A raycast tests the same nodes events do, so a scene with nothing interactive always misses.

## 2D content and the view

The view's {@link IView3DEvents#containsPoint | containsPoint} answers `true` anywhere in its rectangle, so a click on empty space still reaches it, but interactive 2D content behind the view never gets the pointer. Three ways around it:

- Put the 2D content above the view in the display list. It draws on top, and a press on it never reaches the view or an `OrbitCamera` on it.
- Give the view a {@link IView3DEvents#hitArea | hitArea} that covers only part of it. Outside it, events reach what's behind the view.
- Set the view's `eventMode` to `'none'` when its scene needs no pointer at all.

## Next steps

- [View3D and the 2D/3D bridge](../../__docs__/concepts/view3d.md): converting between screen and world positions.
- [Camera controls](../../extras/__docs__/camera-controls.md): the orbit and first-person controllers.
