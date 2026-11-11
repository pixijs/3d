# Render state

A material's render state: how its colour blends with what's behind it, whether nearer surfaces hide it, and which
faces it skips. `material.state` is pixi's `State`, and its `blendMode`, `depthTest` and `cullMode` apply to every draw
with the material. Glowing balls add their colour over a two-tone wall, white on the left and night on the right; a
purple pin with its depth test off slides out from behind the wall and back, showing through it; and an open tube
culls its back faces, so only its near half draws. A state change after the first render takes `invalidate()` on each
mesh that wears the material.

![A two-tone clay wall over the light checker floor: on its white half three additive balls blend to plain white, and on its night half pink, sky and orange balls brighten where they overlap; a purple pin shows through the night half above its balls, under a line tagged pin, and an open sky tube, ringed with eight ink arrows tagged front side, shows only its near half; the pane in the top right shows blendMode add, depthTest off, Slide on, pin.position.x -0.35 and cullMode back](reference.png)

## API

- `Material3D` `state`, pixi's `State`: `blendMode` (`'normal'`, `'add'`, `'multiply'`) on the balls' three glow
  materials, `depthTest` on the pin's, and `cullMode` (`'back'`, the default, `'front'`, `'none'`) on the tube's.
  `doubleSided: true` is the option for a surface meant to be seen and lit from both sides.
- `Material3D` `alphaMode: 'blend'`: puts the glows and the pin in the transparent pass, which draws after every
  opaque mesh and writes no depth, so a blend always meets the finished wall and the pin can draw over it.
- `Material3D` `emissive` (`color`, `strength`) over a black `baseColor` with `specular: { factor: 0 }`, `roughness`
  1 and `fog: false`: each ball adds or multiplies one flat colour that the lights and haze don't touch.
- `Mesh3D` `invalidate()`: WebGL and WebGPU both keep drawing with the old state until a mesh rebuilds, so each setter
  calls it on every mesh that wears the changed material. Two balls share each glow material, so one write changes both.
- `CylinderGeometry` (`radiusTop`, `radiusBottom`, `height`, `openEnded: true`): the tube, open at both ends where its
  culled faces show.
- `Mesh3D`, `Container3D` and `Vector3`: the wall, the balls and the pin, built with `position`, `scale` and `parent`.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with azimuth limits that keep the balls over their halves.
- `Application`, and the `BLEND_MODES` and `CULL_MODES` types, from `pixi.js`.

## Controls

- Drag to orbit.
- The pin slides out from behind the wall and back on its own, because watching it pass the wall is the depth lesson.
  Pane: `blendMode` sets the balls' blend; `depthTest` turns the pin's depth test on and off; `Slide` runs or pauses
  the slide; `pin.position.x` places the pin, and moving it pauses the slide; `cullMode` picks the tube's culled faces.

## Files

- `index.ts`: the lesson. The glow, pin and tube materials and their state, the setters that invalidate, the pane
  and the slide.
- `scene.ts`: the two-tone wall, where the balls, the pin and the tube stand, and the pin's slide over time.
- `visuals.ts`: the arrows out of the tube's front side and the line up from the pin, with their tags.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `ThemePane`, `LoadingScreen`, `LabelLayer`,
`ArrowHelper`, `fitPortrait`, `clayGeometry`, `roundedBox`, `clayMaterial` and `createClayMaterial`, `NARROW_BELOW`,
and `BRAND`, `THEMES` and `themeFromUrl` from the palette.

## See also

- [Outlines and wireframes](../post_material-passes/README.md): passes a material joins by name, another way it
  changes how its meshes draw.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_render-state` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
