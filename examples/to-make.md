# Examples to make

The educational examples, in build order. Each one teaches one feature, or a few that belong together;
`README.md` in this folder is the guide every example follows. The list was drafted on 2026-10-01 from
the public API, then checked against the engine on 2026-10-22, with the old examples' lessons folded in before they
were removed.

Each entry names the example's id (its folder is `examples/<id>/`), what it teaches, the API a reader should leave
knowing, the scene, what the frame has to show (with the kit's helpers and labels; see "The picture shows the core"
in `README.md`), and the pane's controls. An entry without a "Show" line still follows that rule: the builder
decides what draws each concept. "Logo" means the floating PixiJS logo from `loadPixiLogo`; "clay" means the kit's
clay shapes and colours. Every entry is built except sprites_lit-sprites, which is paused on an engine bug. An entry
is the plan an example was built from; where they differ, the example's own README says what it draws.

The 2026-10-29 coverage review added 15 more lessons. Which are built, and the engine bugs that paused the rest,
are tracked in [Additional educational examples](implementation-status.md), along with the paused entry here.
Paused drafts wait on the `examples-paused` branch, out of the gallery.

## Getting started

### start_hello-cube: Hello cube

The smallest scene: an `Application`, a `View3D`, one `Mesh3D` with a `CubeGeometry` and a `Material3D`, and a
`DirectionalLight`. No stage and no pane, so every line on screen is engine API: a clay-pink cube turning on the light
theme's haze.

### start_model-viewer: Model viewer

Drop a .glb or .gltf on the page and it shows on the stage, framed and lit: `URL.createObjectURL` and `Assets.load`
with the parser named, `new Model3D`, framing on its bounds, and releasing the model it replaces. Scene: the logo file
on the stage until the reader drops their own. Pane: the file's name, auto-rotate, frame the model.

### start_renderers: WebGL and WebGPU

The same scene on both backends: pixi's `preference`, reading `app.renderer` to show which one runs, and shipping one
backend only with `@pixi/3d/webgl` or `@pixi/3d/webgpu` and `skipExtensionImports`. Scene: the logo and clay. Pane:
switch backend (reloads with `?renderer=`), the active backend as a read-only row.

## 2D and 3D together

### 2d3d_view-in-ui: A 3D view inside a 2D UI

A `View3D` is a pixi container: position, size, `anchor` and `composite` over a 2D background, beside pixi UI. Shows
how the view shares pointer input with 2D around it (`hitArea`, `eventMode`), so 2D content behind it still gets
clicks. Scene: a 2D card layout with the logo in one card. Pane: the view's position, size and `composite`.

### 2d3d_coordinates: Between screen and world

`worldToScreen` pins 2D labels to 3D objects; `screenToRay` and `screenToWorld` turn a click into a point on the
floor. Scene: clay shapes with pixi `Text` name tags; a tap drops a new shape where it lands. Pane: label offset, clear
the placed shapes.

### 2d3d_container-texture: A live 2D scene on a 3D surface

`ContainerTexture` renders a pixi container into a texture a material samples: every frame for animation, or only
when the content changes. Scene: the kit's clay monitor, its screen showing the PixiJS wordmark bouncing over a clock. Pane: render every frame
or on change, the screen's resolution.

### 2d3d_many-views: Several views in one stage

Many `View3D`s side by side in one pixi stage, each with its own camera and scene. Scene: a grid of product cards,
each with one clay shape. Pane: the card count, which card's shape spins.

### 2d3d_filters: Pixi filters on a 3D view

Pixi filters, masks and alpha apply to a `View3D` like any container. Scene: the logo view with a blur, a colour
matrix and a rounded mask. Pane: each filter on and off, its strength, the view's alpha.

### 2d3d_glass-over-2d: Glass over 2D

A transmissive mesh refracts the pixi stage behind the view (`useBackBuffer`). Scene: a glass logo floating over 2D
text and shapes; dragging turns the logo freely in any direction. Pane: `transmission`, `ior`, thickness.

## Scene graph

### scene_hierarchy: Parents and children

A child moves, turns and scales with its parent; `visible` hides a whole branch. Scene: a clay solar system, planets
on spinning parents and moons on the planets. Show: the empty parent nodes the planets and moons hang from, each with
a small `AxesHelper`, so a reader sees a parent spin and carry its children round; labels naming one branch's levels
(`sun`, `orbit`, `planet`, `moon`). Pane: each level's spin speed, show or hide a branch, scale a branch.

### scene_transforms: Position, rotation and scale

`position`, the three ways to turn a node (`rotation` in radians, `angle` in degrees, `quaternion`), `scale`, and
`origin` as the point a node turns about. Scene: the logo's P, and a clay door on a hinge. Show: the P's own axes
(`AxesHelper` as its child, so they turn and stretch with it); a ghost of the P at rest, so each change shows against
it; an arrow from the parent's origin to `position`; an arc about the turning axis, whose turn the pane shows in both
units (`angle` in degrees beside `rotation` in radians); for `quaternion`, the axis as an arrow through the P and
the arc about it; the door's `origin` as a marked hinge point with its swing arc, against a ghost of the door turning
about its middle. Keep it readable: the transform the pane last changed stands out and the rest stay quiet. Pane:
position, angle (rotation shown beside it), the quaternion's axis and angle, scale, the door's origin.

### scene_look-at: Pointing at things

`lookAt` turns a node so its +z faces a point; `toLocal` and `toGlobal` move points between nodes' spaces. Scene:
three clay turrets (a base, a head that turns, a barrel along the head's +z) in a shallow arc, tracking a target that
floats over the floor in front of them. Show: each head's +z as an arrow down its barrel; a thin line from each head
to the target, where `lookAt` points it, and while a turret lags, the turn still to go as an arc between the two;
the target's height, with a drop line and a ring on the floor; the muzzle from `toGlobal`, marked where the beam
starts. Craft: the turrets read as turrets, no line crosses another turret, the target is the focal point. Pane:
target speed, turn rate, which turret's local view to read, and that turret's view of the target from `toLocal` as a
read-only row (x and y near 0 mean dead ahead).

### scene_bounds: Size and bounds

`width`, `height` and `depth`, `getLocalBounds`, fitting any model to a box, and `boundsVolume` for a large subtree.
Scene: clay shapes and the logo scaled to fit identical boxes. Show: each box and each model's bounds with the kit's
`BoxHelper`. Pane: the box size, show the bounds, and one model's measured `width`, `height` and `depth` as read-only
rows, beside the box size it was fitted to.

### scene_find-and-reparent: Finding and moving nodes

`label` and `getChildByLabel` find nodes; `reparentChild` moves one to a new parent and keeps where it is in the
world, where `addChild` keeps its local position and jumps; `Container3D` events (`added`, `childAdded`, `removed`)
report changes. Scene: the logo split across two boards, `left` and `right`, that face different ways. Show: a frame
round the found node and a line from its parent's origin to it. Pane: the label to find and `deep`, an `addChild`
and a `reparentChild` button that each move the found piece to the other board, its parent and `position`, Reset, a
log of the events.

## Geometry

### geometry_shapes: The built-in shapes

Every built-in geometry and its options. Scene: the shapes in a row in clay colours. Pane: the selected shape's
options (segments, radius, size).

### geometry_custom: Geometry from arrays

`Geometry3D` from your own positions, normals, UVs and indices: a heightmap terrain, then the same buffers rewritten
every frame for waves. Scene: a clay-coloured terrain patch. Pane: height, wave speed, static or animated.

### geometry_vertex-data: Vertex colours and custom attributes

Vertex colours (`material.vertexColors = true`), the second colour set `colors1` for shader data, and a custom
attribute read by a shader bit. Scene: a palette-coloured low-poly mound. Pane: vertex colours on and off, the
attribute's effect.

### geometry_lines-and-points: Lines and points

`topology` draws line lists and point lists (always 1 px wide), and `indexCount` draws part of a geometry, so a line
grows across the scene. Scene: a pink path tracing over the floor, a point cloud. Pane: topology, how much is drawn.

### geometry_morph-targets: Morph targets in code

`morphTargets` on a `Geometry3D` and `weights` on its `Mesh3D` blend between shapes. Scene: a clay blob that morphs
between a sphere, a cube and a star. Pane: one weight per target.

## Materials

### materials_pbr: Metal and roughness

`Material3D` basics: `baseColor`, `metallic`, `roughness`. Scene: the logo, re-skinned with a `Material3D`, beside a
row of spheres sweeping each value. Pane: the three values on the logo.

### materials_textures: The PBR texture set

Base colour, normal, occlusion, metallic-roughness and emissive textures, and what each adds. Scene: a textured model
from the manifest on the stage. Pane: each texture on and off.

### materials_clearcoat: Clearcoat

A clear lacquer over the base layer, like car paint: `clearcoat` and its roughness. Scene: the logo in a pale base
colour. Pane: the clearcoat values, the base roughness.

### materials_sheen: Sheen

The soft edge glow of fabric and velvet: `sheen` colour and roughness. Scene: the logo as pink velvet. Pane: sheen
colour and roughness.

### materials_iridescence: Iridescence

Thin-film colour that shifts with the view angle, like a soap bubble: `iridescence`, its IOR and thickness range.
Scene: the logo turning slowly so the colours travel. Pane: the iridescence values.

### materials_anisotropy: Anisotropy

Highlights stretched along a direction, like brushed metal: `anisotropy` strength and rotation. Scene: the logo in
metal. Pane: strength, rotation.

### materials_specular-ior: Specular and IOR

How strongly a dielectric reflects: `specular` factor and colour, and `ior`. Scene: the logo in a dark plastic. Pane:
the specular values, `ior`.

### materials_transmission: Glass and liquids

Transmission, thickness and attenuation (`volume`) for glass and tinted liquids. Scene: a glass logo and a clay
bottle of pink liquid. Pane: transmission, thickness, attenuation colour and distance, `ior`.

### materials_lighting-models: PBR, Phong and flat

`Material3D`, `PhongMaterial` and `FlatMaterial` side by side: what each costs and how each looks. Scene: three logos.
Pane: the Phong shininess, a shared colour.

### materials_toon: Toon shading

`ToonMaterial`: bands, rim light and the outline pass. Scene: clay shapes and the logo in cel shading. Pane: band
count, rim, outline width and colour.

### materials_alpha: Transparency

`alphaMode`: opaque, `'mask'` with `alphaCutoff`, and `'blend'`; `doubleSided` for cards seen from behind. Scene: two
cards wearing the PixiJS wordmark in its brand colours, clear round the letters, seen front and back, and a glassy
blended logo. The cards cast no shadow (`castShadow: false`) until shadows read `alphaMode` and `doubleSided`. Pane:
the cards' mode, cutoff, opacity and double-sided, the glass logo's alpha.

### materials_flat-shading: Low-poly look

Flat shading gives each face one normal. Scene: low-detail clay shapes. Pane: flat or smooth.

### materials_uv-transform: Scrolling, tiling and atlas frames

`uvTransform` scrolls and tiles a texture; a spritesheet frame as the base colour texture sets the UV transform by
itself, so swapping frames plays a flipbook. Scene: a scrolling stripe belt, a clay screen showing atlas frames.
Pane: scroll speed, tiling, frame rate.

### materials_render-state: Blending, depth and culling

`material.state`: additive blending, depth test off for always-on-top, front and back face culling. Scene: glowing
additive clay, a marker that shows through walls. Pane: blend mode, depth test, cull face.

## Custom shaders

### shaders_extra-bits: Adding to a built-in material

`extraBits` adds a `ShaderBit` to a `Material3D`: a dissolve in the fragment stage and a wobble in the vertex stage.
A bit carries a WGSL block and a GLSL block. Scene: the logo dissolving and reforming. Pane: dissolve amount, edge
colour, wobble.

### shaders_custom-material: Your own material

A material class of your own with uniforms and textures, built on `BaseMaterial3D`. A folder example, so the material
reads on its own. Scene: a clay shape in a stylised material. Pane: its uniforms.

### shaders_lighting-model: A custom lighting model

`createLightingBit` replaces how a material responds to light; `toonLightingBit` is the worked case. Scene: clay
shapes under a custom wrap-lighting model. Pane: its parameters.

## Lighting and environment

### lighting_light-types: The light types

`DirectionalLight`, `PointLight`, `SpotLight` and ambient light, what each lights and what it costs. Scene: the logo
and clay with one light of each kind, their colours from the palette. Pane: each light's on, colour, intensity, and
the spot's cone and penumbra.

### lighting_many-lights: Many lights

Up to 32 lights at once: moving point lights over a clay field. Pane: the light count, speed.

### lighting_environment: Environment light

Where image-based light comes from: a cube map (with it as the background), a hemisphere of two colours, and a flat
`ColorCubeTexture`. Scene: the metallic logo, whose reflections show each. Pane: the source, intensity.

### lighting_hdr-environment: HDR environment

A Radiance `.hdr` sky keeps light brighter than white, and a JPG one stops at white. `Assets.load` turns an `.hdr`
panorama into a float `CubeTexture` (the `loadHdr` parser) for `environment` and `background`; lower `exposure` and the
`.hdr` sun still burns in every reflection while the JPG one dims, and only the `.hdr` half has light past white for
`BloomEffect` to glow from. Scene: a split screen, `.hdr` on one side and `.cubemap` on the other, each with a
near-mirror metal logo and a chrome ball, one orbit for both. Show: a caption per half naming its source. Pane:
exposure in stops for both views, the bloom on and off and its threshold.

### lighting_tone-mapping: Tone mapping and exposure

`toneMapping` and `exposure`: how bright light becomes screen colour. Scene: the logo under strong light, emissive
clay. Pane: the mode, exposure.

### lighting_fog: Fog

Linear, exponential and exponential-squared fog, and a plain-colour `background` matched to the fog. Scene: rows of
clay into the distance. Pane: fog type, near and far or density, colour.

## Shadows

### shadows_basics: Shadows

`castShadow` and `receiveShadow`, the quality tiers, `shadowFilter`, and `bias` and `normalBias` against acne and
peter-panning, from a directional light and a spot light. Scene: the logo and clay over the floor. Pane: quality,
filter, biases, which light.

### shadows_large-scenes: Shadows over a large world

Cascaded shadows for a big outdoor scene, a fixed `bounds` box as the cheaper option, and updating shadows only when
asked or every few frames for mobile. Scene: a long avenue of clay shapes. Pane: cascades or fixed box, update rate.

## Cameras

### cameras_projection: Perspective and orthographic

`Camera3D` projection: perspective with `fov`, orthographic for an isometric view. Scene: a clay town block. Pane:
projection, fov, zoom.

### cameras_orbit: Orbit camera

`OrbitCamera`: damping, limits, zoom to the cursor, touch, `autoRotate`, its `change` events, `saveState` and
`reset`, and rendering only when the camera moves to save battery. Scene: the logo. Pane: damping, limits,
auto-rotate, reset, render on demand.

### cameras_first-person: First-person camera

`FPSCamera`: pointer lock, WASD, and `move` driven by an on-screen joystick for touch. Scene: a clay maze on the
floor. Pane: speed, look sensitivity.

### cameras_render-to-texture: Second cameras

A camera with a `renderTexture`, drawn by a `MeshPass` that names it: a security monitor, a minimap, and split screen
with `viewport`. Scene: clay shapes, a camera on a pole, the kit's monitor showing its view. Pane: the second camera's position, split
screen on and off.

### cameras_mirror: A planar mirror

A mirror from a reflected camera, a render texture and a clipping plane. Scene: the logo over a mirrored floor panel.
Pane: mirror resolution, tint.

## Models and assets

### assets_gltf: Loading glTF

Load a GLB through pixi's `Assets`, find its parts by label, place several `Model3D`s from one `Scene3DSource`, and
repaint them all through the source's material. Scene: a model from the manifest, three copies. Pane: the shared
material's colour, which copy is selected.

### assets_model-materials: Materials per model

`model.materials` gives one `Model3D` materials of its own while the others from the same `Scene3DSource` keep the
source's: `clone()` copies with `dissolveBit` added, and `undefined` to go back, destroying the copies. Scene: three
helmets from one model in the manifest, each tagged with the materials it draws. Pane: each helmet's dissolve.

### assets_compression: Compressed models and textures

Draco, meshopt and quantized geometry, and KTX2, WebP and AVIF textures (KTX2 needs pixi's ktx2 import), all loaded
with the same call. Scene: a grid of Khronos samples from the manifest, one per encoding, each tagged. Pane: the theme
only.

### assets_gltf-scenes: Lights, cameras and scenes in glTF

A glTF file's lights, cameras and multiple scenes: switch between the cameras it ships. Scene: a glTF from the
manifest with cameras. Pane: the camera, the scene.

### assets_lifetime: Unload and rebuild

`removeChild`, `unload()` and `destroy()` with `Destroy3DOptions`, and what each keeps: `removeChild` frees nothing,
`unload()` frees the GPU copy and the next render uploads it again, `destroy()` ends it for good, and a flag left off
leaks what it guards. Scene: three clay castles, each taken out a different way. Pane: take them out and bring them
back, the destroy flags, live GPU and CPU memory, free what leaked.

## Animation

### animation_clips: Playing clips

`AnimationPlayer`: play a clip, loop, speed (negative plays backwards), `gotoAndStop`, `onComplete` and `onLoop`, and
blending walk into run with state weights. Scene: a skinned character from the manifest. Pane: the clip, speed, blend
weight.

### animation_keyframes: Keyframes in code

`Animation` and `AnimationPlayer` on any `Container3D`, with `Vector3Track`, `QuaternionTrack` and `NumberTrack`
(which can drive a light's intensity), and step, linear and cubic interpolation. Scene: the logo's pieces assembling
from keyframes. Pane: interpolation, play, scrub.

### animation_bones: Driving bones in code

Move a bone from code, so a character's head follows the cursor; `bindContainerBone` makes a bone follow a container
you move. Scene: a skinned character from the manifest. Pane: follow strength.

### animation_morph-targets: Morph targets from glTF

A glTF model's morph targets played as a clip, and its weights set by hand. Scene: a morphing model from the
manifest. Pane: one slider per weight, play the clip.

### animation_crowd: A crowd of characters

Many skinned characters sharing one rig, each with its own player and clip time. Scene: a small crowd on the floor.
Pane: crowd size.

### animation_gsap: Tweening with GSAP

GSAP tweens a node's position, rotation and scale and a material's colour. Needs `gsap` as a dev dependency first.
Scene: the logo pieces bouncing in. Pane: replay, ease.

## Sprites and billboards

### sprites_sprite3d: Sprites in 3D

`Sprite3D`: anchor, pixel size, tint, and spherical or cylindrical billboarding; `billboardMode` on any mesh. Scene:
pixi wordmark sprites and clay billboards. Pane: billboard mode, size, tint.

### sprites_lit-sprites: Lit sprites that cast shadows

Sprites lit by the scene's lights and casting shadows: paper cut-outs in a 3D world. Scene: wordmark cut-outs on the
stage. Pane: lit or unlit, shadows.

## Instancing and scale

### instancing_batching: Automatic batching and culling

Thousands of `Mesh3D`s that share a material draw in a few calls; `cullMode` off, CPU or GPU (GPU on WebGPU, CPU on
WebGL), and `cullFrustum` to watch the culling from outside. Scene: a field of clay. Pane: count, cull mode, the
draw-call count from `RenderGraphDebugger`.

### instancing_batched-mesh: BatchedMesh3D

`BatchedMesh3D` for 100k instances: per-item geometry and material, `setVisibleAt`, and writing `matrices` in place.
Scene: a clay swarm. Pane: count, visible share.

### instancing_instance-data: Per-instance data

`instanceData` fields read by a shader bit, so thousands of items animate without rewriting matrices. Scene: a clay
wave of tens of thousands of shapes. Pane: wave speed, colour spread.

## Particles

### particles_basics: A particle system

`ParticleSystem3D`: rate, bursts, emitter shapes, gravity, drag, and size, alpha and colour over life. Scene: a
fountain of palette sparks. Pane: rate, shape, gravity, drag.

### particles_flipbook: Fire and smoke

Flipbook particles, billboard modes (including flat ground rings) and blend modes. Scene: a clay campfire. Pane:
blend mode, billboard mode.

### particles_spaces: Local and world space

`space: 'local'` moves particles with the emitter; `'world'` leaves a trail. Scene: an emitter on an orbiting clay
shape. Pane: the space.

### particles_spawn: Bursts on demand

`spawn()` bursts at a point, here a tap on the floor; `stop()` against `clear()`; `createRandom` with `seededRandom`
for a replayable effect, and scrubbing time with `gotoAndStop`. Scene: taps make sparks. Pane: burst size, replay,
scrub.

### particles_custom-emitter: A custom emitter shape

Your own `EmitterShape`: particles emitted from a mesh's surface, here the logo dissolving into sparks. Pane: rate,
dissolve.

### particles_container: Particles you drive yourself

`ParticleContainer3D`: raw particles whose positions you write, for point clouds and custom simulations. Scene: a
pink point-cloud logo. Pane: count, noise.

### particles_custom-bits: Custom particle behaviour

A particle shader bit: motion computed in the vertex shader, so it costs nothing on the CPU. Scene: a swirl of
sparks. Pane: the bit's parameters.

## Interaction

### interaction_pointer-events: Pointer events

`eventMode`, `pointertap`, `pointerover` and `pointerout`, `cursor`, `wheel` and the context menu on meshes, the same
API as pixi. Scene: clay shapes that react. Pane: the event log.

### interaction_event-flow: Event propagation

Capture and bubble through `Container3D`s, `stopPropagation` (which also keeps an `OrbitCamera` still),
`eventMode` values and `interactiveChildren`. Scene: nested clay groups. Pane: stop at a level, the event log.

### interaction_hit-volumes: Hit volumes

`hitVolume`: box, sphere, exact geometry, or a custom shape, and what each costs. Scene: clay shapes with their hit
volumes shown. Pane: the volume per shape.

### interaction_paint: Painting on a mesh

The hit's `uv` and `normal` say where a pointer touches a surface; paint into a canvas texture there. Scene: a clay
shape you paint on. Pane: brush size, colour, clear.

### interaction_drag: Dragging objects

Drag across a plane with `globalpointermove` and `pointerupoutside`. Scene: clay shapes you slide over a board.
Show: while a shape is held, the drag plane as a sheet at the grabbed height, and a dot where the pointer's ray meets
it. Pane: snap to grid.

### interaction_raycast: Picking from your own loop

`View3D.raycast` with a reused `createRaycastHit3D` result, for hover picking every frame without allocating. Scene:
a clay field that lights up under the pointer. Pane: hit info as read-only rows.

## Post-processing and passes

### post_bloom: Bloom

`BloomEffect` on emissive materials with `emissiveStrength` above 1; its threshold, levels and resolution. Scene: a
glowing logo on the dark stage. Pane: threshold, strength, levels.

### post_ssao: Ambient occlusion

`SsaoEffect` darkens creases and contact points; samples and resolution trade quality for cost. Scene: clustered clay
shapes. Pane: on and off, radius, samples.

### post_tilt-shift: Tilt shift

`TiltShiftEffect` blurs above and below a band, so a scene reads as a miniature. Scene: a clay town from above. Pane:
band position, width, blur, debug view.

### post_motion-blur: Motion blur

`MotionBlurEffect` streaks each pixel by how far its surface moved on screen since the camera's last render, so only
the camera's motion counts; `intensity`, `samples` and `maxLength`; `camera.resetHistory()` on a cut; `VelocityViewer`
shows what the blur follows. Scene: the camera orbits the logo inside a ring of clay posts, which streak, while a clay
top spins sharp beside the logo. Show: the velocity in an inset with its own view and camera. Pane: auto-rotate and its
speed, the effect's settings, the viewer's scale.

### post_antialiasing: Anti-aliasing

MSAA from `antialias` against `FxaaEffect`, the cheap mobile option. Scene: thin clay edges at a distance. Pane: MSAA,
FXAA.

### post_effect-stack: Stacking effects

`passes` holds several effects in order; `enabled` skips one and keeps it in the list, and a flip rebuilds the graph
once; `TintEffect` is the simplest. Scene: the logo through a stack. Pane: each effect on and off.

### post_material-passes: Outlines and wireframes

A material opts into the outline pass (`enablePass`), so a hover highlights one mesh; the wireframe pass as a debug
view. Scene: clay shapes that outline on hover. Pane: outline colour and width, wireframe.

### post_passes-per-mesh: Passes per mesh

A mesh joins or leaves a pass on its own: `mesh.enablePass` and `disablePass` beside the material's, `castShadow` as
the `'shadow'` pass, and `disablePass('opaque')` for a mesh that casts a shadow with no body. Pointer events still hit
it. Scene: a field of clay shapes sharing two materials, with an `OutlinePass` on hover, and a hidden capsule whose
shadow walks between them. Show: a tag over the shadow with nothing above it. Pane: join by mesh or by material, the
capsule's opaque, cast shadow and wander.

### post_portal: Portals

`PortalPass` and `PortalMaterial`: a window into another scene. Scene: a clay doorway onto a dark-theme world. Pane:
the portal's shape.

### post_custom-effect: Writing a post effect

A `PostEffect` of your own, a vignette in one WGSL and one GLSL string, and a multi-pass effect through `build()`.
Scene: the logo through it. Pane: the effect's uniforms.

### post_custom-mesh-pass: A custom mesh pass

A `MeshPass` of your own: an x-ray silhouette of objects behind walls. Scene: clay behind clay walls. Pane: the
silhouette colour.

### post_render-graph: The render graph

The passes `createDefaultGraph3D` builds, a `Pass3D` added at a pass stage, and the `graph` option to append where no
stage reaches. Scene: the logo with a scan ring a custom pass draws; insets along the bottom show the frame after the
opaque pass, after the transparent pass and at the end of the graph. Pane: the scan on and off, its ring, how many
times the view built its graph.

### post_scene-outputs: Scene outputs

A `SceneOutput` is an extra texture every opaque surface writes in the same draw that shades it: `normalOutput`, and
two of your own (albedo and depth) through a `ShaderBit` that writes `outputs.<name>`; `ExtractPass` makes the view
write one and copies it into a texture you keep; blended surfaces write none, and each output is one more colour
attachment. Scene: the logo over an arc of clay shapes, one of them see-through. Show: a card per output. Pane: each
pass on and off, the see-through shape, the attachments written.

## Debug tools

### debug_graph-overlay: Seeing the frame

`GraphDebugOverlay` shows every render pass on screen; `RenderGraphDebugger` captures the frame as data: passes,
draws, batches, and what made them rebuild. Scene: the theme kit scene. Pane: the overlay, capture.

### debug_thumbnails: Geometry thumbnails

`GeometryThumbnailGenerator` renders small previews of geometry, for an asset browser. Scene: a pixi grid of clay
thumbnails. Pane: thumbnail size.

## Waiting on the engine

These need public API that doesn't exist yet, so they wait:

- **Fit a camera to an object**: the framing `View3D.from` does is internal.
- **Attach a prop to a bone**: no public API reads a bone's world transform, only its skinning matrix
  (`Skeleton.worldMatrix`); `bindContainerBone` works the other way.
- **Inspect shadow maps with `DepthMapViewer`**: nothing public hands out the shadow map texture.
- **A material that reads the scene behind it** (depth-aware water): a custom material can't join the refraction pass
  through the public API.
- **Point light shadows**: point lights don't cast shadows.
- **Debug drawings** (grid, axes, wire boxes): waiting on the debug line drawings PR.
- **Line and triangle strips**: they black out the WebGPU frame, so the lines example uses lists.

## Not in this set

Multi-feature showcases (a configurator, an isometric town, an arcade cabinet) are built as directed short films, not
lessons, and live outside this list.
