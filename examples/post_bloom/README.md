# Bloom

A post effect that makes light brighter than white glow out past its edges. `BloomEffect` reads the scene as linear
light, before the tone curve, so a pixel can pass 1. It keeps the pixels brighter than its `threshold`, blurs them
through a pyramid of textures and adds them back. The default threshold, 1, is white: no surface the dark stage lights
gets past it, and an `emissive` strength past 1 is how you make a surface brighter on purpose. The neon logo glows into
the sky around it, and the row in front shows where the threshold cuts: the lit white cube and the ball at 0.5 don't
glow, the ball at 2 just does, and the ball at 6 glows hard, its core clipped near white while its halo stays pink.

![The neon hot pink PixiJS logo on the dark checker floor, glowing pink into the dark sky around it; in the row in front, tagged no emissive and emissive.strength, a white cube with no glow, then balls at 0.5, 2 and 6: dark pink with no glow, bright pink with a faint halo, and a near-white ball with a wide hot pink halo; the pane shows Theme Dark, bloom enabled, threshold 1.00, intensity 2.00, radius 0.80, levels 5, resolution 0.5, view3d toneMapping none and neon.emissive strength 1.50](reference.png)

## API

- `BloomEffect` from `@pixi/3d/extras`, in `View3D`'s `passes`. It runs at the default `'beforeToneMapping'` stage,
  so the view draws the scene as linear light into a float texture and applies its tone curve after the bloom.
  `threshold` is the brightness, on a pixel's brightest channel, above which it blooms. The example keeps the default
  of 1, white, so only light past white glows; a knee fades bloom in from half the threshold to one and a half times
  it. `intensity` is the glow's strength, 2 here so a ball's small halo shows, and `radius` how far coarser levels
  blend in. These three are uniform writes, free every frame.
- `BloomEffect` `levels` (textures in the blur pyramid, each doubling the reach) and `resolution` (texels a logical
  pixel for the largest): both size the effect's textures and are fixed at construction, so a change builds a new
  effect, sets a new `passes` array and calls `destroy()` on the old one, which the view never destroys itself.
- `BloomEffectOptions`: the shape of the pane's settings object.
- `enabled` on the effect: flipping it rebuilds the render graph once and recompiles the materials, since the tone
  curve moves between them and the output pass; writing the value it already has costs nothing.
- `Material3D` with an `emissive` group (`color`, `strength`) on a near-black `baseColor` and `fog: false`: the neon
  logo at strength 1.5 and the three balls. Hot pink's red channel is 1, so `strength` is how far past white the
  surface goes. `material.emissive` is an `EmissiveProps`, whose `strength` the pane sets on the logo.
- `Mesh3D` and `Container3D`: the glow row, a white clay cube with no emissive, then balls at strengths 0.5, 2 and 6.
- `View3D`: the scene and its `camera`. `toneMapping` (a `ToneMapping`) stays at the kit's `'none'`, which clips each
  channel at 1, so the 6 ball's core turns near white; the pane switches it to `'aces'`, which rolls bright light off
  toward white instead and darkens the kit's colours. A change rebuilds the view's render graph.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit.
- Pane: the `bloom` folder sets `enabled`, `threshold`, `intensity`, `radius`, `levels` and `resolution`; the
  `view3d` folder sets `toneMapping` to `none` or `aces`; the `neon.emissive` folder sets the logo's `strength`.
- URL flags: `?theme=light|dark` (dark when absent), `?renderer=webgl|webgpu`.

## Files

- `index.ts`: the lesson. The effect, the neon material, and the rebuild when `levels` or `resolution` change.
- `scene.ts`: the glow row, a lit white cube and three emissive balls.
- `controls.ts`: the pane.
- `visuals.ts`: the row's tags, naming each ball's strength.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `loadPixiLogo` with `material: 'source'` and
`setMaterial()`, `clayMaterial`, `clayGeometry`, `BRAND`, `THEMES`, `themeFromUrl`, `ThemePane`, `LoadingScreen`,
`LabelLayer` with `NARROW_BELOW`, and `fitPortrait`.

## See also

- [Stacking effects](../post_effect-stack/README.md): several effects in `passes`, each switched by `enabled`.
- [Tone mapping](../lighting_tone-mapping/README.md): how a frame brighter than white maps onto the screen.
- [Anti-aliasing](../post_antialiasing/README.md): MSAA and FXAA on a view that runs post effects.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the dark theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_bloom` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
