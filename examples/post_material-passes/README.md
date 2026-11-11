# Outlines and wireframes

Passes a material joins by name. `OutlinePass` redraws each member as a slightly larger shell turned inside out, so
only a rim shows round it, and `WireframePass` draws each member's edges as lines, a debug view. The puck, sphere and
torus wear a clay material each, and the outline moves to whichever one the pointer last entered: `disablePass` on the
old one's material, `enablePass` on the new one's. Width and colour are compiled into the outline's shader, so a new
value builds a new pass, while the wireframe turns on and off with `enabled`.

![An orange puck, a purple sphere and a sky-blue torus in a row over the light checker floor, with a hot pink rim round the sphere, the one in the outline pass, and no wireframe; the pane in the top right shows the OutlinePass folder with width 0.05 and color hot pink, and the WireframePass folder with enabled off](reference.png)

## API

- `OutlinePass` from `@pixi/3d/extras`, with `width` (0.05, in each mesh's own units) and `color`: a `MeshPass` named
  `'outline'` that draws an inverted hull. Both values are constants in its shader, so a pane change builds a new one,
  assigns `view3d.passes = [outline, wireframe]`, which rebuilds the render graph on the next render, and calls
  `destroy()` on the old one, since the view never destroys a pass it drops.
- `WireframePass` from `@pixi/3d/extras`, with `color` and `enabled: false`: a `MeshPass` named `'wireframe'`, drawn
  without depth testing, so the far side's edges show through. It pairs the triangle indices two at a time: enough to
  inspect a mesh, not an exact wireframe. Flipping `enabled` rebuilds the graph: fine for a switch, not every frame.
- `material.enablePass(name)` and `disablePass(name)`: join and leave a pass. Every mesh wearing the material joins
  too; each shape here has its own. The outline's shader is built the first time a material joins and kept, so moving
  it on every hover is cheap. Every shape joins `'wireframe'` up front; `passes: { wireframe: true }` on a new
  material does the same.
- `Mesh3D` with `eventMode: 'static'`, `hitVolume: 'geometry'` and `cursor: 'pointer'`, listening for
  `pointerenter`: picked by its triangles, so the torus's hole hovers nothing. `Container3D` is the shapes' parent.
- `View3D` with `passes`, and its `camera`; `OrbitCamera` from `@pixi/3d/extras`, kept above the floor.
- `Application` from `pixi.js`.

## Controls

- Drag to orbit. Hover or tap a shape to move the outline onto it; it stays on the last one entered.
- Pane: the `OutlinePass` folder's `width` and `color` (`hot pink`, `sky` or `orange`) build a new pass; the
  `WireframePass` folder's `enabled` turns the wireframe on.

## Files

- `index.ts`: the lesson. Both passes, the hover that moves the outline, the rebuild and the pane.
- `scene.ts`: the puck, sphere and torus, which hear the pointer, and their idle turns.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayMaterial` and `clayGeometry` (with
`ClayShape` and `ClayColor`), `ThemePane`, `LoadingScreen`, `fitPortrait`, and `BRAND`, `THEMES` and `themeFromUrl`
from the palette.

## See also

- [Custom mesh pass](../post_custom-mesh-pass/README.md): a `MeshPass` of your own, with its own render state and
  stage.
- [Toon shading](../materials_toon/README.md): `OutlinePass` as the ink line of a cel-shaded look.
- [Passes per mesh](../post_passes-per-mesh/README.md): `enablePass` on one mesh, so one of several sharing a material
  outlines, and a mesh that leaves `'opaque'` but still casts its shadow.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- post_material-passes` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
