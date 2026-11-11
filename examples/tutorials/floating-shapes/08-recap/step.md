---
title: Recap
---

You've built a scene of clay shapes floating in a lavender sky, with a camera that follows the pointer and 2D text on top. Along the way you used:

- an `Application` that asks for WebGPU and falls back to WebGL2;
- a {@link View3D} to draw 3D on the 2D stage, with its {@link Camera3D}, and a second view behind it under a 2D filter;
- a {@link Hemisphere} that paints the background and lights the scene, and a {@link DirectionalLight} that casts shadows;
- {@link Material3D} with roughness, a clear coat and flat shading;
- six primitive geometries, and meshes that share geometries and materials instead of each making its own;
- {@link Container3D}, the ticker and {@link seededRandom} to place and move the shapes;
- `globalpointermove` and {@link Container3D#lookAt | lookAt} to steer the camera.

## Where to go next

- [View3D and the 2D/3D bridge](../../../../src/__docs__/concepts/view3d.md) covers views of any size, several views, and filters.
- [Scene graph and transforms](../../../../src/__docs__/concepts/scene-graph.md) explains positions, rotations and how a parent moves its children.
- [Materials](../../../../src/materials/__docs__/materials.md) and [Lights](../../../../src/scene/__docs__/lights.md) go further into surfaces and lighting.
- [Geometry](../../../../src/geometry/__docs__/geometry.md) lists every primitive.

The next tutorial, [Model Showroom](https://pixijs.com/3d/tutorials/model-showroom), loads an animated model, lights it with a photo of a real place and adds 2D buttons.
