---
title: Introduction
description: What PixiJS 3D is, what it covers, and which guide to read for each part.
category: getting-started
---

# Introduction

PixiJS 3D, the `@pixi/3d` package, draws 3D scenes in a PixiJS application. A scene lives in a {@link View3D}, a display object you add to the stage like a sprite. [Hello cube](/3d/examples?example=start_hello-cube) shows the smallest scene: a cube and a light in a view.

## How 2D and 3D fit together

2D content later in the display list draws over the scene, and 2D content earlier shows behind it unless you give the view a {@link View3D#background | background}. By default the view {@link IView3DEvents#containsPoint | takes the pointer} anywhere in its rectangle, so 2D content behind it can't be clicked, tapped or hovered. [Interaction](../../events/__docs__/interaction.md#2d-content-and-the-view) shows the ways around it.

The scene inside a view is a tree of its own: {@link Container3D} nodes under the view's {@link View3D#root | root}. A 2D display object can't go in that tree, and a 3D node can't go on the stage. To show 2D content on a 3D surface, draw it into a {@link ContainerTexture} ([Rendering 2D into 3D](../../core/__docs__/container-texture.md)). To pin a 2D label over a 3D object, use {@link View3D#worldToScreen | worldToScreen} ([View3D and the 2D/3D bridge](../concepts/view3d.md)).

Inside the scene, +Y points up, and the defaults expect one unit to be a metre, not a pixel. A camera draws nothing past its {@link Camera3D#far | far} distance, 1000 units by default, so a scene built at pixel sizes gets cut off.

## What it covers

Some parts come from `@pixi/3d/extras`, another entry point that [Installation](./installation.md) explains.

- **Scene graph.** Meshes, models, lights and cameras are all nodes, each with a position, rotation and scale relative to its parent. See [Scene graph and transforms](../concepts/scene-graph.md) and [Scene objects](../../scene/__docs__/scene.md).
- **Meshes.** A {@link Mesh3D} draws a geometry, its shape, with a material, the look of its surface. Built-in shapes such as {@link CubeGeometry} cover the basics, and a {@link Geometry3D} holds your own vertex data. See [Meshes](../../scene/__docs__/meshes.md) and [Geometry](../../geometry/__docs__/geometry.md); [Resources and cleanup](../concepts/resources.md) covers sharing geometries and materials between meshes, and freeing their GPU memory.
- **Sprites and batched meshes.** A {@link Sprite3D} is a flat textured rectangle that turns to face the camera {@link Sprite3DOptions#billboardMode | by default}. {@link BatchedMesh3D} draws thousands of rigid meshes from one node. See [Sprite3D](../../scene/__docs__/sprite3d.md) and [Batched meshes](../../scene/__docs__/batched-mesh.md).
- **Models.** `Assets.load` reads glTF, an open standard format for 3D models, from `.gltf` and `.glb` files. A {@link Model3D} builds a loaded file's meshes, lights and cameras as nodes under itself. See [Loading models](../../assets/__docs__/models.md) and [Compressed models](../../assets/__docs__/compression.md).
- **Animation.** The model's {@link Model3D#player | player} {@link AnimationPlayer#play | plays} a file's animation clips by name and {@link AnimationState#weight | blends} them. See [Animation](../../animation/__docs__/animation.md).
- **Materials.** {@link Material3D} is physically based: it shades a surface the way real materials reflect light. {@link PhongMaterial} costs less per pixel, {@link FlatMaterial} draws with no lighting, and the extras add {@link ToonMaterial} for cartoon shading. See [Materials](../../materials/__docs__/materials.md).
- **Lights and shadows.** {@link DirectionalLight} shines one way everywhere like the sun, {@link PointLight} every way like a bulb, {@link SpotLight} a cone like a torch, and {@link AmbientLight} from no direction. Directional and spot lights can {@link Light#castShadow | cast shadows}. See [Lights](../../scene/__docs__/lights.md) and [Shadows](../../scene/__docs__/shadows.md).
- **Environment.** The view's {@link View3D#environment | environment} lights the scene from its surroundings, with a {@link Hemisphere} sky-and-ground gradient or a cube map, a six-sided picture of them. See [Environment](../../scene/__docs__/environment.md).
- **Cameras.** A {@link Camera3D} shows the scene in perspective, where far things look smaller, or orthographic, where they don't, set by its {@link Camera3D#mode | mode}. The extras' {@link OrbitCamera} lets the user drag the camera around a target point, and {@link FPSCamera} gives first-person controls. See [Cameras](../../scene/__docs__/cameras.md) and [Camera controls](../../extras/__docs__/camera-controls.md).
- **Interaction.** 3D nodes take PixiJS's pointer events: set a node's {@link Container3D#eventMode | eventMode} and listen on it as in 2D. See [Interaction](../../events/__docs__/interaction.md).
- **Particles.** The extras' {@link ParticleSystem3D} emits and moves particles for effects such as fire and snow, and {@link ParticleContainer3D} draws particles that your own code moves. See [Particles](../../extras/__docs__/particles.md).
- **Post-processing.** The extras hold effects that change the finished picture, such as the {@link BloomEffect} glow, and passes, extra drawing steps that redraw meshes, such as {@link OutlinePass}'s ink outlines. Both go in the view's {@link View3D#passes | passes}. See [Post-processing](../../post-processing/__docs__/post-processing.md).
- **Math.** {@link Vector3} and {@link Matrix4}, {@link Quaternion} for rotations, and shapes such as {@link Ray}, {@link Plane} and {@link Box}. See [Math](../../math/__docs__/math.md).
- **Debugging.** The extras' {@link GraphDebugOverlay} records frames and lists what each one drew. See [Debugging](../../extras/__docs__/debugging.md).

There's no physics engine; bring your own.

## Renderers and phones

PixiJS 3D draws with WebGPU or WebGL2. [WebGL and WebGPU](../concepts/webgl-and-webgpu.md) covers choosing one.

[Performance](../concepts/performance.md) explains what keeps a frame cheap, and has a checklist for phones.

## Next steps

- [Installation](./installation.md): install `@pixi/3d` and the `pixi.js` version it needs.
- [Quick start](./quick-start.md): build a first scene step by step, then load a model into it.
- [View3D and the 2D/3D bridge](../concepts/view3d.md): size a view and mix it with 2D content.
- [Scene graph and transforms](../concepts/scene-graph.md): the axes and units, and where 3D differs from 2D.
