# Video texture

One video texture feeds two meshes, so both displays always show the same frame. `Assets.load` turns a clip into a
`Texture` whose `VideoSource` uploads each new frame while the video plays, and both materials take that one texture:
nothing copies pixels per frame, and pausing the video freezes both displays. Two clay monitors float side by side,
the left one showing the clip unlit, as authored, and the right one lit and shaded by the stage's lights.

![Two lilac clay monitors floating side by side over the light checker floor, both showing the same frame of the clip, clay shapes in front of a cream backdrop; the left one, tagged unlit display, shows it as authored, and the right one, tagged lit display, shows it dimmer and pinker; the pane in the top right shows Pause and Release video enabled, Play and Reload video greyed out, and Playback Playing](reference.png)

## API

- `Assets.load` from `pixi.js` with `{ src, data: { autoPlay: false, loop: true } }`: resolves once the video can play,
  with a `Texture` whose `source` is a `VideoSource`. The loader mutes the clip and plays it inline by default, so it
  can start without a tap.
- `texture.source.resource`, the video element: its `play()` starts the clip, muted, as the example opens, and
  `pause()` holds the frame. A browser can still refuse to play (iOS in Low Power Mode), and Play is the fallback.
- `FlatMaterial` and `Material3D`, each given the one texture as `baseColorTexture`: the unlit display and the lit
  one.
- Release puts `Texture.WHITE` in each material's `textures.baseColor`, since no material may keep a texture about to
  be destroyed, then `Assets.unload` destroys the texture, its `VideoSource` and the video's download. Reload loads a
  fresh clip and gives it to both materials.
- `Container3D`: each monitor's root, with its origin at the screen's centre.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, short of seeing the screens edge-on.
- `Application`, `Assets`, `Texture` and the `VideoSource` type from `pixi.js`.

The clip is `video('pixijs.SharedVideoMotion')` from `examples/assets/manifest.ts`, a silent 4 s loop of clay shapes,
864 × 496 H.264 with its index at the front. It was made for this
example with an AI asset generator from no outside footage or reference, so no third-party licence applies to it.

## Controls

- Drag to orbit.
- Pane: `Play`, `Pause`, `Release video` and `Reload video`, each enabled only where it does something, and a
  read-only `Playback` row that reads Playing, Paused, Press Play, Released, Loading or Load failed. The Theme row
  relights the stage, which changes only the lit display.

## Files

- `index.ts`: the lesson. The shared texture, the two materials, and play, pause, release and reload.
- `controls.ts`: the pane's buttons and the `Playback` row, keeping each button enabled only where it works.
- `scene.ts`: the two monitors, sized to the clip's aspect, each wearing one material.
- `visuals.ts`: the unlit display and lit display tags.

From the theme kit (`examples/shared/theme/README.md`): `createMonitor` with `flipV`, since a video stores its top row
first; `ThemeStage`, `ThemePane`, `LoadingScreen`, `LabelLayer`, `fitPortrait`, and `THEMES` and `themeFromUrl` from
the palette.

## See also

- [Container texture](../2d3d_container-texture/README.md): a live 2D pixi scene as the texture instead of a clip.
- [UV transform](../materials_uv-transform/README.md): a moving picture from atlas frames.
- [Unload and rebuild](../assets_lifetime/README.md): what `unload()` and `destroy()` free, and what they keep.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- materials_video` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
