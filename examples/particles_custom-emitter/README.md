# Custom emitter

An emitter shape of your own: sparks that start on the PixiJS logo's surface, at the edge of a burn eating across it.
`ParticleSystem3D` asks its `shape` where each new particle starts and which way it heads, through the one method an
`EmitterShape` has, `sample(rng, outPos, outDir)`. `SurfaceShape` answers with points baked on the logo's triangles
and their outward normals, taken only from the strip past its `front`; a shape is a plain object, so moving `front` on
a running system moves where the next sparks start.

![The pink PixiJS logo over the light checker floor with its P, its first i and the left of its x burnt away; the cut edge glows orange, dotted with the strip's small pink baked points, and orange sparks cooling to pink stream off it and drift up and left over the burnt part; the pane in the top right shows emitRate 220, front -0.30 and Points Strip](reference.png)

## API

- `EmitterShape` from `@pixi/3d/extras`, implemented by `SurfaceShape`: `sample(rng, outPos, outDir)` writes a
  start point and a direction into the two vectors, and must not allocate, since it runs for every spark.
- `ParticleSystem3D` from `@pixi/3d/extras` with a `SurfaceShape` as its `shape`: each spark leaves its point along the
  face's normal at `speed`, `drag` spends that, and an upward `gravity` vector lifts it like an ember. `color` and
  `colorEnd` cool it from orange to pink, and `size`, `sizeEnd` and `alphaEnd` fade it out.
- `createRandom: () => seededRandom('sparks')`: the `rng` that `sample` receives comes from here, so every run throws
  the same sparks. `seededRandom('surface')` seeds the bake too.
- `play()` and `stop()`: the shape always answers with a point, so the system stops while the strip holds none, and
  live sparks finish.
- `emitRate`, bound to the pane, and `autoUpdate: false` with `update(ticker)` from the app's ticker.
- `Mesh3D`, `Container3D`, `Matrix4` and `Vector3`: the bake reads each mesh's indexed triangles into the logo's space
  through `getGlobalTransform()`, picks a triangle in proportion to its area and a point inside it, `points` times up
  front, and sorts the points along x so the strip is one run of the list.
- `Material3D` with a `ShaderBit` in `extraBits`: the burn that cuts the logo at the same x. Its `burnFront` and
  `burnColor` fields join `material.data` (`Material3DData`), and `srgbToLinear` with `Color` from `pixi.js` decodes
  the burn's colour into linear light.
- `OrbitCamera` from `@pixi/3d/extras` on the `View3D`: drag to orbit.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: `emitRate` sets sparks a second; `front` moves the burn and the emitting strip across the logo; `Points`
  shows the strip's baked points alone (`Strip`), every baked point (`All baked (by area)`), or as many corners picked
  by vertex (`Picked by vertex`), which crowd onto edges and curves and leave big faces bare.

## Files

- `index.ts`: the lesson. The shape, the system, the burn following `front`, and the pane.
- `SurfaceShape.ts`: the custom `EmitterShape`, which bakes points by area and samples the strip past `front`.
- `scene.ts`: the burn, a shader bit on the logo's material that cuts it and lights a band past the cut.
- `visuals.ts`: the baked points as dots; it reads the shape and never changes it.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo`, `ThemePane`, `LoadingScreen`,
`fitPortrait`, the palette, `sparkTexture()` and `PointsHelper`.

## See also

- [Particle system](../particles_basics/README.md): the four built-in shapes this one stands in for.
- [Custom particle behaviour](../particles_custom-bits/README.md): next, motion of your own in the particle shader.
- [Particle container](../particles_container/README.md): the same logo sampled by area, as raw particles you move.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- particles_custom-emitter` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
