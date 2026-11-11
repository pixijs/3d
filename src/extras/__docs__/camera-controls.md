---
title: Camera controls
description: Orbit and first-person camera controllers for mouse, touch and keyboard, and how to write your own.
category: extras:camera
---

# Camera controls

`@pixi/3d/extras` has two controllers that move {@link View3D#camera | view3d.camera} for you. {@link OrbitCamera} turns it around a point as the user drags, for model viewers and strategy maps. {@link FPSCamera} turns it with the mouse or a finger and moves it with the keys, for walking through a scene.

A controller owns the camera's rotation, so steer through it rather than the camera's {@link Container3D#lookAt | lookAt}: the orbit turns the camera to face its target on every update, and the first-person camera sets the rotation from its yaw and pitch, how far it has turned left or right and tilted up or down.

## Orbit camera

Place the camera, then give the controller the view and the point to orbit:

```ts
import { OrbitCamera } from '@pixi/3d/extras';

view3d.camera.position.set(0, 2, 6);

const orbit = new OrbitCamera({
  view: view3d,
  target: { x: 0, y: 1, z: 0 },
  enableDamping: true,
  minDistance: 2,
  maxDistance: 12,
  maxPolarAngle: Math.PI * 0.48,
});
```

{@link OrbitCamera} lists its mouse and touch gestures, and {@link OrbitCamera#mouseButtons | mouseButtons} and {@link OrbitCamera#touches | touches} reassign them. The controller starts from wherever the camera is, so move the camera away from the {@link OrbitCamera#target | target} first: a new camera sits at the origin, the default target, with no distance to turn or zoom through.

When a file has no camera, {@link View3D.from} places a new one facing the middle of the model, but the orbit's target still starts at the origin, so the orbit turns the camera to face the origin, and the top of a tall model standing there leaves the screen. Pass the model's centre as the target:

```ts
const orbit = new OrbitCamera({ view: view3d, target: view3d.root.getLocalBounds().getCenter() });
```

To drag an object without turning the camera, stop the event's propagation, as [Dragging](../../events/__docs__/interaction.md#dragging) shows. A drag that orbits the camera and ends on the model it started on still fires `pointertap` on it; [Clicks, hover and cursors](../../events/__docs__/interaction.md#clicks-hover-and-cursors) shows how to tell the two apart.

PixiJS listens for the wheel passively, so in a page that scrolls, the wheel scrolls the page as well as zooming, and in Chrome a trackpad pinch zooms the whole page. A listener of your own on the canvas stops both and leaves the zoom working:

```ts
app.canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
```

### Damping and auto-rotate

With {@link OrbitCamera#enableDamping | enableDamping} on, turning and panning carry on for a moment after the pointer stops moving and ease to a stop; zooming still applies at once. {@link OrbitCamera#autoRotate | autoRotate} turns the camera around the target on its own, for a turntable, and pauses while the user drags.

### Limits

{@link OrbitCamera#minDistance | minDistance} and {@link OrbitCamera#maxDistance | maxDistance} bound how close to the target and how far from it the camera gets, so size them to the model. An orthographic camera, which draws far things as large as near ones, zooms by changing its {@link Camera3D#zoom | zoom} instead, which {@link OrbitCamera#minZoom | minZoom} and {@link OrbitCamera#maxZoom | maxZoom} bound. {@link OrbitCamera#maxPolarAngle | maxPolarAngle} limits how low the camera goes. The {@link OrbitCamera#polarAngle | polar angle} is 0 straight above the target and π/2 level with it, so a little under π/2 keeps the camera above the target's height, and above a floor the target sits on.

### Map-style controls

{@link OrbitCamera#zoomToCursor | zoomToCursor} makes the wheel zoom toward the point under the pointer, and a pinch toward the point between the fingers. With {@link OrbitCamera#screenSpacePanning | screenSpacePanning} off, a pan slides the target across the ground at its own height instead of across the screen. With the left button and one finger set to pan, they make a map or strategy-game camera:

```ts
view3d.camera.position.set(0, 10, 10);

const orbit = new OrbitCamera({
  view: view3d,
  zoomToCursor: true,
  screenSpacePanning: false,
  mouseButtons: { left: 'pan', right: 'rotate' },
  touches: { one: 'pan', two: 'zoom-rotate' },
  minDistance: 4,
  maxDistance: 40,
  maxPolarAngle: Math.PI / 3,
});
```

> [!NOTE]
> For content built with Z as its up axis rather than Y, such as terrain from map data, keep {@link OrbitCamera#up | up} at its default, +Y, and stand the content upright in a {@link Container3D} with `rotation.x = -Math.PI / 2`.

### Moving the camera from code

{@link OrbitCamera#rotate | rotate}, {@link OrbitCamera#pan | pan} and {@link OrbitCamera#zoom | zoom} move the camera as a gesture would, for keyboard shortcuts or buttons, and damping eases a turn or a pan the same way.

```ts
// Swing round and up from the starting view, and step back a little
orbit.rotate(0.7, 0.35);
orbit.zoom(0.8);
```

To jump to a new view, set the camera's `position` and the `target` together, and the controller takes up both on its next update, within its limits. With damping on, a turn or pan still gliding when you jump carries on from the new view. [Framing a model](../../scene/__docs__/cameras.md#framing-a-model) works out how far back to put the camera.

## First-person camera

```ts
import { FPSCamera } from '@pixi/3d/extras';

const walker = new FPSCamera({
  view: view3d,
  position: { x: 0, y: 1.7, z: 9 },
  pointerLock: true,
});
```

The [First-person camera](/3d/examples?example=cameras_first-person) example walks a clay maze, with an on-screen stick for touch.

Dragging looks around, the WASD or arrow keys walk, and Space and Shift rise and sink. With {@link FPSCamera#pointerLock | pointerLock} on, a mouse press captures the pointer instead of starting a drag, so moving the mouse looks around until the user presses Escape; touch still looks by dragging. The example folds its pane away while the pointer is captured, on the controller's `lock` and `unlock` events. A page in a sandboxed iframe without `allow-pointer-lock` can't capture the pointer, and with `pointerLock` on, the mouse then can't look at all, so turn `pointerLock` off when the document fires `pointerlockerror` before any capture has worked.

The camera starts facing -Z, into the screen, whatever rotation it had before, unless you pass a {@link FPSCamera#yaw | yaw} and {@link FPSCamera#pitch | pitch}. Turn it with those two; unlike a 2D rotation, a positive yaw turns it left. W walks the way the camera looks, pitch included, so looking down while walking sinks the camera through the floor; the controller has no gravity or walls. [Updating each frame](#updating-each-frame) holds it at eye height.

The keys are read from `window`, so typing W into a text field on the page walks too. Turn {@link FPSCamera#keyboard | keyboard} off while a field has focus.

### Touch joystick

To walk on a touch screen, draw a joystick as a 2D container above the view, as the example does, so it takes the presses in its corner before the view can. Write the stick into {@link FPSCamera#move | move}, which the controller adds to the keys on every update, and set it back to zero on release:

```ts
// In the joystick's globalpointermove listener, with dx and dy the finger's offset from where
// it pressed, kept within 60 pixels. Screen y grows downward, so pushing the stick up (a
// negative dy) gives a positive z, which walks forward.
walker.move.set(dx / 60, 0, -dy / 60);

// In its pointerup and pointerupoutside listeners
walker.move.set(0, 0, 0);
```

## Updating each frame

By default both controllers update from `Ticker.shared`, while an `Application` renders from its own `app.ticker`. To run code right after the camera moves and before the frame is drawn, turn {@link FPSCamera#autoUpdate | autoUpdate} off and call {@link FPSCamera#update | update} from `app.ticker` yourself; it returns `true` when the camera moved. To hold a walker at eye height:

```ts
walker.autoUpdate = false;

app.ticker.add((ticker) => {
  if (walker.update(ticker)) walker.camera.position.y = 1.7;
});
```

Space and Shift then do nothing, and looking down slows the walk, since only the level part of each step is left. {@link OrbitCamera#autoUpdate | OrbitCamera's autoUpdate} works the same way; its glide and auto-rotate move the camera only while something calls `update` every frame.

## Switching controllers

Call {@link OrbitCamera#destroy | destroy} on one controller before you make another for the same view, since two at once fight over the camera. Destroy a controller with its view too: the view doesn't know about it, so one left behind keeps updating from `Ticker.shared` and holds the view in memory, and an {@link FPSCamera} keeps reading keys from `window`. {@link FPSCamera#destroy | Destroying} either one leaves the camera where it is, so a walker can carry on from the orbit's view:

```ts
import { Vector3 } from '@pixi/3d';

orbit.destroy();

// A camera looks along its local -Z axis; turn that direction into yaw and pitch
const facing = new Vector3(0, 0, -1).applyQuaternion(view3d.camera.quaternion);
const walker = new FPSCamera({
  view: view3d,
  yaw: Math.atan2(-facing.x, -facing.z),
  pitch: Math.asin(facing.y),
});
```

## Writing your own controller

A 2D game often scrolls by moving a world container; in 3D you move the camera instead, and a controller is just code that does that every frame. A camera that follows a player keeps an offset from it and eases toward that spot, so it trails a little behind quick moves:

```ts
import { Vector3 } from '@pixi/3d';

const offset = { x: 0, y: 6, z: 8 }; // fixed in the world, so the camera keeps its angle when the player turns
const focus = new Vector3();
const gap = new Vector3();

app.ticker.add((ticker) => {
  // Close the same share of the gap each second, whatever the frame rate
  const ease = 1 - Math.exp(-4 * (ticker.deltaMS / 1000));

  player.getGlobalPosition(focus);
  gap.copyFrom(focus).add(offset).subtract(view3d.camera.position);
  view3d.camera.position.addScaledVector(gap, ease);
  view3d.camera.lookAt(focus);
});
```

## Next steps

- [Cameras](../../scene/__docs__/cameras.md): field of view, orthographic cameras and framing a model.
- [Interaction](../../events/__docs__/interaction.md): pointer events on 3D objects.
- [View3D and the 2D/3D bridge](../../__docs__/concepts/view3d.md): 2D controls drawn over a 3D scene.
