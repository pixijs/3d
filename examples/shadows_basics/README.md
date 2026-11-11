# Shadows

A shadow takes three flags: the light casts, the mesh in its way casts, and the surface behind receives. A sun, or a
spot the pane swaps in, throws the PixiJS logo's shadow onto a pale blue wall, and two rays from the light graze the
logo's edges to where the shadow's edges land. The `up close` inset magnifies the shadow's top edge, where the map's
size, its filter and the biases show: too little bias stripes a surface with acne, too much lifts a shadow off its foot.

![The pink PixiJS logo floating in front of a pale blue clay wall on a white plinth, with an orange sphere and a lilac cube standing on the plinth and the logo's soft shadow on the wall; two ink rays from the light, tagged sun, pass the logo's edges and turn into pink dashes ending in dots on the shadow's edges, a small rectangle on the wall marks the patch the up close inset in the bottom right magnifies, a soft shadow edge; the pane in the top right shows Light DirectionalLight, the sun's castShadow on, bias 0.001 and normalBias auto, the logo's castShadow and the wall's receiveShadow on, shadowQuality medium and shadowFilter pcf](reference.png)

## API

- `DirectionalLight` and `SpotLight` with `castShadow: true` and one `shadow` options object they share; the pane
  shows one at a time by `visible`, since a hidden light lights and casts nothing. `lookAt` aims each. A sun's shadow
  depends only on its direction; a spot's is one perspective map over its cone (`coneAngle` 36, `penumbra` 0.2).
- `light.shadow.bias`, a depth offset as a share of the map's depth range: at 0 the wall and plinth stripe with acne,
  and from about 0.02 under the sun the sphere's contact shadow lets go of its foot, peter-panning.
- `light.shadow.normalBias` moves the lookup along the surface's normal, scaled by 1 − N·L, so it clears stripes
  without moving the shadow. Left `undefined` (`auto` in the pane), the engine picks three texels for a sun, 0.15 for
  a spot.
- `Mesh3D` `castShadow` and `receiveShadow`: the wall and plinth do both, so they can show acne; the logo only casts.
  A change to the wall's `receiveShadow` calls `wall.invalidate()`, since its shader keeps or drops the shadow lookup.
- `View3D` `shadowQuality` (`'low'` 512 texels a side up to `'ultra'` 4096; `'medium'` here) and `shadowFilter`
  (`'hard'`, `'pcf'` or `'pcf-high'`: one, four or nine reads a pixel; a change recompiles every lit material).
- `Vector3`, `Matrix4`, `Plane` and `Ray`: where each drawn ray lands on the wall or the plinth (`intersectPlane`);
  `Container3D` is the rays' parent. The loupe outlines its patch with the view's `worldToScreen`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held above the floor and in front of the wall.
- `Application`, `DEG_TO_RAD`, `Point` and `Rectangle` from `pixi.js`: the loupe's field of view and its outline.

## Controls

- Drag to orbit.
- Pane: `Light` picks `DirectionalLight` (the sun) or `SpotLight`, and `Move light` stops its sway. The light's folder,
  `sun` or `spot`, sets `castShadow`, `bias` and `normalBias`; `logo` sets `castShadow`, `wall` sets `receiveShadow`,
  and `view3d` sets `shadowQuality` and `shadowFilter`. `Reset` puts everything back.

## Files

- `index.ts`: the lesson. The two lights and their shadow options, the wall, the logo's flags, the map's size and
  filter, and the lights' sway.
- `scene.ts`: the plinth, the orange sphere and lilac cube on it, and how far each light sways.
- `controls.ts`: the pane.
- `visuals.ts`: the spot's lamp, the tag naming the light, and the `peter-panning` tag, shown under the sun from 0.02.
- `rays.ts`: two rays past the logo, solid ink while the light gets through, dashed pink to a dot on the shadow's edge
  while the logo blocks it; and the point on the shadow's top edge the loupe aims at.
- `loupe.ts`: the `up close` inset, from the main camera's eye with a narrow field of view so a shadow-map texel keeps
  its size at any orbit distance, and its patch outlined on the main view.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, its key light hidden for the example's own;
`clayMaterial`, `clayGeometry`, `roundedBox`, `loadPixiLogo`, `ThemePane`, `LoadingScreen`, `fitPortrait`,
`InsetView`, `LabelLayer`, `ScreenLines`, `LightHelper`, `ArrowHelper`, `PathHelper` and `DotHelper`.

## See also

- [Large scenes](../shadows_large-scenes/README.md): cascades and a fixed box, for a world one map can't hold sharp.
- [Light types](../lighting_light-types/README.md): what a directional light, a spot and a point light each light.
- [Passes per mesh](../post_passes-per-mesh/README.md): a mesh that draws nothing but its shadow, and `castShadow` as
  the `'shadow'` pass.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- shadows_basics` checks the example against it on WebGPU and WebGL; add `--update` to
retake it after an intended change.
