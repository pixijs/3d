# Additional educational examples

The 2026-10-29 coverage review added 15 lessons. Ten are working examples. Five are paused on engine bugs, and so is
one lesson from `to-make.md`, sprites_lit-sprites; their scenes, with a note or a repro for each blocker, wait on the
`examples-paused` branch.

## Implemented

Each has a README and a reference image, and the visual test checks it on WebGPU and WebGL.

| Example                                                            | What it teaches                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [materials_extension-maps](materials_extension-maps/README.md)     | Clearcoat, anisotropy, sheen, specular, transmission and thickness texture channels |
| [geometry_vertex-formats](geometry_vertex-formats/README.md)       | Packed attributes, interleaving and real buffer byte costs                          |
| [geometry_tangent-space](geometry_tangent-space/README.md)         | Tangents, and how they turn a normal map's colours into directions on a mesh        |
| [cameras_clipping](cameras_clipping/README.md)                     | Near/far clipping and the non-linear distribution of perspective depth              |
| [post_custom-tone-mapping](post_custom-tone-mapping/README.md)     | Floating-point linear light, a custom display curve and separate encoding           |
| [instancing_lod](instancing_lod/README.md)                         | Application-level geometry choice, hysteresis, triangle and switch counts           |
| [materials_video](materials_video/README.md)                       | One decoded video source shared by materials, playback and release/reload           |
| [shaders_projected-textures](shaders_projected-textures/README.md) | One world-space texture crossing independent meshes, compared with mesh UVs         |
| [post_depth-of-field](post_depth-of-field/README.md)               | Camera-depth mip blur, click-to-focus and a diagnostic focus mask                   |
| [interaction_decals](interaction_decals/README.md)                 | Marks stamped where the pointer hits a surface, from a pool of planes reused        |

The transmission-map lesson first failed because its renderer setup left out the documented WebGL back buffer; with
`webgl: { useBackBuffer: true }` it works, so that was never an engine blocker. Tangent space and decals were paused
for a while on a bug where 3D and 2D textures batched together collide. The bug is unfixed, but neither example draws
the 2D previews that hit it any more.

[materials_alpha](materials_alpha/README.md), from `to-make.md`, was paused on the shadow bug below and now ships
around it: its cards are built with `castShadow: false`, as the materials guide advises for masked meshes, until
shadows read `alphaMode` and `doubleSided`. sprites_lit-sprites stays paused on that bug, since casting shadows is its
lesson.

## Paused

These wait on engine fixes. Their scenes, repros and QA notes are kept on the `examples-paused` branch, out of the
gallery.

| Example                       | Blocker                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| shaders_custom-shadows        | A material's custom shadow shader can't read `material`: the shadow pass compiles it without its fields     |
| animation_procedural-skeleton | WebGPU: pixi's vertex layout cache keys on attribute locations alone, so two shaders share the wrong layout |
| shaders_refraction            | The pass-bit registry doesn't seed `blendedRefraction`, so a material that joins it gets the wrong bit      |
| materials_procedural-textures | `FullscreenPass` can't read an imported persistent texture: `RenderGraph._inputClamp` throws                |
| post_scene-transitions        | A `View3D` with no meshes never runs its render graph, and it hits the same imported-texture throw          |
| sprites_lit-sprites           | Shadows ignore `alphaMode: 'mask'`: the masked wordmark cutouts cast solid quads                            |

No dummy geometry, copied engine internals, alternate vertex layout or reduced-scope stand-in was used to hide a
blocker. Resume one once its engine fix lands: bring its folder back, turn its repro into an `index.ts` if it has
none, and give it a README and a reference image if it lacks them.

Multiple UV sets and per-texture filtering parity are left out: the coverage review found them to be engine work.
