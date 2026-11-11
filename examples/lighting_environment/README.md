# Environment light

Where image-based light comes from. `view3d.environment` lights the scene from every direction at once, and it's the
only light here: a cube map gives it six photos, a `Hemisphere` two colours and a `ColorCubeTexture` one. A pale pink
metal PixiJS logo mirrors whichever source is on, a chrome ball shows its reflections and a matte grey ball its soft
average. `view3d.background` draws a source behind the scene apart from the light: with it off, the logo still
mirrors the source.

![The pale pink metal PixiJS logo floating in front of a blurred Venice waterfront at dusk, with a chrome ball on the left tagged reflections and a matte grey ball on the right tagged soft light; the pane in the top right shows source Cube map and background on](reference.png)

## API

- `View3D` `environment`: the light every surface takes from its surroundings. The pane swaps it between a
  `CubeTexture`, a `Hemisphere` (`skyColor`, `groundColor`) and a one-colour cube; a change of kind rebuilds the
  material shaders, so the example draws each source once behind the loading screen.
- `View3D` `background`: what draws behind the scene, the same cube map or hemisphere, or a plain colour for the flat
  source. `null` draws nothing, and the app's clear colour shows while the logo still mirrors the environment.
- `ColorCubeTexture.from(color)`: a cube map of one texel a face, so switching to and from a real cube map never
  rebuilds a material shader.
- `Material3D` with `baseColor`, `metallic` and `roughness`: the logo's near-mirror metal (roughness 0.08), the chrome
  ball (`metallic: 1`, `roughness: 0`) and the matte ball (`roughness: 1`, `specular: { factor: 0 }`, so it shows the
  soft light and nothing else).
- `Mesh3D`, `SphereGeometry` and `Container3D`: the two probe balls, sharing one geometry, under the view's `root`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, with no limit round the turn, to find the sunset behind the
  camera that the logo mirrors.
- `Application`, `Assets` and `CubeTexture` from `pixi.js`: `Assets.load` reads the `.cubemap` file, JSON naming six
  face images.

## Controls

- Drag to orbit, all the way round.
- Pane: `Source` picks `Cube map`, `Hemisphere` or `Flat colour`; `background` draws the source behind the scene or
  leaves the clear colour.

## Files

- `index.ts`: the lesson. The three sources, the logo's metal and sway, and the pane.
- `scene.ts`: the chrome and matte probe balls.
- `visuals.ts`: the tags under the two balls.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage` with `lights: false`, its floor hidden and the fog
off, for the theme alone; `loadPixiLogo`, `ThemePane`, `LoadingScreen`, `LabelLayer`, `fitPortrait`, and `BRAND`,
`THEMES`, `mixColor` and `themeFromUrl` from the palette.

## See also

- [Light types](../lighting_light-types/README.md): the direct lights that add to the environment's.
- [Metal and roughness](../materials_pbr/README.md): how `metallic` and `roughness` turn the environment into
  reflections.
- [HDR environment](../lighting_hdr-environment/README.md): a sky loaded from an `.hdr` file, whose sun stays brighter
  than white in every reflection.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- lighting_environment` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
