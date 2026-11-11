---
title: Recap
---

You've built a showroom for an animated fox from a glTF file. It's on a round stand in front of a photo of a real place, with a camera that circles it, buttons that fade between its animations and a label pinned to its head. Along the way you used:

- a cube map loaded with `Assets.load` as a {@link View3D}'s environment and background;
- a {@link Model3D} built from a loaded {@link Scene3DSource}, scaled by its {@link Container3D#height | height};
- an {@link OrbitCamera} with limits, damping and auto-rotate;
- an {@link AnimationPlayer} and the weights of its {@link AnimationState}s to fade between animations;
- PixiJS `Graphics` and `Text` buttons over the view, laid out again on resize;
- {@link Container3D#toGlobal | toGlobal} and {@link View3D#worldToScreen | worldToScreen} to pin a 2D label to a point on the model;
- a {@link DirectionalLight} that casts the model's shadow onto a stand.

## Where to go next

- [Loading models](../../../../src/assets/__docs__/models.md) covers what a glTF file can bring, freeing a file, and `View3D.from`, which sets up a view around one model.
- [Animation](../../../../src/animation/__docs__/animation.md) goes further into players and states, and into how a model bends with its bones (skinning) or blends between shapes (morph targets).
- [Environment and IBL](../../../../src/scene/__docs__/environment.md) covers sky gradients, tone mapping and fog.
- [Camera controls](../../../../src/extras/__docs__/camera-controls.md) covers the orbit camera's other settings, and a first-person camera.
- [Shadows](../../../../src/scene/__docs__/shadows.md) covers shadow quality, soft edges, and shadows across a large world.

The next tutorial, [Shooting Gallery](https://pixijs.com/3d/tutorials/shooting-gallery), builds a small game with picking, particles and post-processing.
