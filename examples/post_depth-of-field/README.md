# Depth of field

A post effect of your own that keeps one camera depth sharp and blurs what's nearer or farther. `DepthOfFieldEffect`
reads each pixel's depth with `viewPos(uv)` and samples a coarser mip level of its input the farther that depth is
from `focusDistance`. The sharp band is a plane facing the camera, so the floor at the torus's depth stays sharp with
it. Picking the blur per pixel is cheap but wrong at silhouettes: the sharp torus wears a soft blue halo, and the
blurred cube stops dead where it crosses the sharp band, both things `TiltShiftEffect` handles.

![The light checker floor with three clay shapes at three depths, a pink cube near on the left, a sky-blue torus in the middle and an orange crystal far on the right: the torus and a band of floor at its depth are sharp, while the cube, the crystal and the rest of the floor blur; the pane in the top right shows Focus on Middle torus and the DepthOfFieldEffect folder with enabled on, focusDistance 13.3, focusRange 0.65, blurRadius 20 and showFocus off](reference.png)

## API

- `PostEffect`: the engine class `DepthOfFieldEffect` extends. `DepthOfFieldEffect.ts` holds the shader, an
  `EffectFragment` in WGSL and GLSL: `-viewPos(uv).z` is the pixel's camera depth, a `smoothstep` from `focusRange`
  to twice it turns the gap to `focusDistance` into a blur amount, and `sampleColorLod(uv, lod)` reads the mip level
  that amount picks. Calling `viewPos` is what makes the base class's `build()` give the pass the scene depth.
- `PostEffect` `inputMips = true`: the chain allocates the effect's input with a mip chain and generates its levels
  after the scene draws, for a mipmap generation and about a third more texture memory.
- The effect's properties are lanes of one `uFocus` vec4 in a `UniformGroup`, written with `writeLane()`, so each is
  a uniform write: `focusDistance` (the plane, in world units in front of the camera), `focusRange` (half the sharp
  band), `blurRadius` (the most blur, in device pixels, so the example multiplies 20 by `app.renderer.resolution`)
  and `showFocus` (tints the sharp band green and the blurred depths purple).
- `PostEffectOptions`: the base options the effect's options extend, here `enabled`.
- `View3D` with `passes: [depthOfField]`: the effect runs at the default `'beforeToneMapping'` stage, on the scene's
  linear light, so the scene draws into a float texture first.
- `Vector3`, `getGlobalPosition()` and `camera.toLocal()`: each frame the picked shape's position goes into camera
  space, and its `-z` becomes `focusDistance`. A depth, not a straight-line distance, so orbiting keeps it in focus.
- `Mesh3D` with `eventMode = 'static'`, `cursor = 'pointer'` and a `pointertap` listener: tapping a shape focuses on
  it.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, kept above the floor.
- `Application` and `UniformGroup` from `pixi.js`.

## Controls

- Tap a shape to focus on it; drag to orbit.
- Pane: `Focus on` picks Near cube, Middle torus, Far crystal or Manual distance; `Manual distance` sets the plane by
  hand and switches to it. The `DepthOfFieldEffect` folder has `enabled`, `focusDistance` (read-only, it follows the
  focus), `focusRange`, `blurRadius` and `showFocus`.

## Files

- `index.ts`: the lesson. The three shapes, tap to focus, the pane, and the plane following the picked shape.
- `DepthOfFieldEffect.ts`: the effect, its shader and its uniform properties.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry` and `clayMaterial`, `THEMES` and
`themeFromUrl`, `ThemePane`, `LoadingScreen` and `fitPortrait`.

## See also

- [Tilt shift](../post_tilt-shift/README.md): `TiltShiftEffect`, which weighs its taps by depth so sharp edges don't
  smear and a blurred foreground spreads over what's behind it.
- [Custom effect](../post_custom-effect/README.md): a post effect's two forms, one fragment or its own `build()`.
- [Motion blur](../post_motion-blur/README.md): `MotionBlurEffect`, a blur by the camera's motion rather than by depth.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_depth-of-field` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
