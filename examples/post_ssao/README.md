# Ambient occlusion

Light from the sky reaches a point in the open from every side, and a point tucked under a ball or into a crease from
fewer. `SsaoEffect` fakes that from the depth buffer after the scene is drawn: it tests points in a hemisphere over
each pixel's surface, darkens the pixel by how many sit behind something near, and multiplies that grey onto the
scene's light before the view encodes it for the screen. Occlusion is sky light that never arrives, so it scales light
the way the lighting does. Five clay shapes rest on and against each other with the key light's shadow off, so every
dark patch is the effect's, and two panels show the same shapes without it and the grey on its own.

![A pink clay cube with a pale blue pyramid on top, a blue capsule against it, a purple ball and an orange torus sit on the light checker floor, with a dark line where each touches the floor and soft grey spreading out under the capsule, the ball and the torus; on the right under the pane, the without SSAO panel shows the same shapes with no grey, and the occlusion only panel below it shows the grey alone round white copies; the pane shows ball height 0.45 and an SsaoEffect folder with enabled ticked, radius 0.60, samples 16, resolution 1 and sample tests 14.7 M](reference.png)

## API

- `SsaoEffect` from `@pixi/3d/extras`, in `View3D`'s `passes`. `radius` is how far round each point it looks for
  occluders, in world units, and `samples` how many points it tests a pixel; both are uniform writes, free every
  frame. `intensity` (1.8, over the 0.9 default) is how dark it gets, and `power` (3, over 1.5) deepens the grey,
  since the screen's encoding lifts the dark values of light: half the light shows as about 0.73. `maxDistance` (0.8)
  is the gap at which an occluder stops counting, so the ball still darkens the floor it touches.
- `SsaoEffect` is a `'beforeToneMapping'` effect, the default for a `PostEffect`: it multiplies light, not the
  picture on screen.
- `SsaoEffect` `resolution` (`0.25`, `0.5`, `1` or `'inherit'`) sizes the occlusion buffers and is fixed at
  construction, so a change builds a new effect, sets it in `passes` and calls `destroy()` on the old one.
- `enabled` on the effect: flipping it rebuilds the render graph of every view that draws it.
- The occlusion panel's own `View3D` draws the same `SsaoEffect` over flat white copies, a `Material3D` that is all
  `emissive`, with `specular` `factor: 0` and `fog: false`. It still writes the depth the effect reads, so only the
  grey shows.
- `Mesh3D`, `Container3D` with `Container3DOptions`, and `PlaneGeometry`: the shapes, the panels' copies sharing each
  `geometry`, and the white floor. `getLocalBounds()` and `toGlobal()` give the `Vector3` corners the panels frame.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held to the front and above, where the contacts show.
- `Application` from `pixi.js`. With `antialias` on the canvas, the scene the effect reads draws multisampled too, so
  edges stay smooth while the effect is on.

## Controls

- Drag to orbit.
- Pane: `ball height` lifts the ball off the floor. The `SsaoEffect` folder sets `enabled`, `radius`, `samples` and
  `resolution`, and `sample tests` counts the main view's sample tests a frame.
- URL flags: `?theme=light|dark`, `?renderer=webgl|webgpu`.

## Files

- `index.ts`: the lesson. The effect, its settings, the rebuild when `resolution` changes, and the cost readout.
- `scene.ts`: the five clay shapes, resting on and against each other.
- `visuals.ts`: the `without SSAO` and `occlusion only` panels, and their layout.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, one for the main view and one for the panel
without the effect; `clayMaterial`, `clayGeometry`, `ClayShape`, `ClayColor`, `InsetView` in its own-scene mode with
`frame()`, `BRAND`, `THEMES`, `mixColor`, `screenColor`, `NARROW_BELOW`, `ThemePane`, `LoadingScreen`, `themeFromUrl`,
and `fitPortrait` with its `PortraitFit`.

## See also

- [Anti-aliasing](../post_antialiasing/README.md): MSAA and `FxaaEffect` on a view that runs post effects.
- [Stacking effects](../post_effect-stack/README.md): several effects in `passes` in order.
- [Scene outputs](../post_scene-outputs/README.md): `normalOutput`, the scene normals `sceneNormals: true` has the
  effect read, and outputs of your own.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_ssao` checks the example against it on WebGPU and WebGL; add `--update` to retake
it after an intended change.
