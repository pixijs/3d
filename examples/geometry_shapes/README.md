# Built-in shapes

The nine built-in geometries, and the options that size and subdivide them. A row of small clay swatches shows every
class at once, and the selected one, a purple sphere at first, stands large above it with its wireframe, its own axes
and a mark for each size option. Each class reads its options once, in its constructor, so a changed option means a
new geometry and `destroy()` on the old one. Every shape is centred on its origin: lengths are full lengths, radii run
from a centre, and segment counts set how many triangles the surface takes.

![A purple clay sphere floating over the light checker floor, drawn with its dark triangle wireframe, x, y and z axis arrows from its centre and a pink arrow tagged radius; below it a row of nine small clay shapes tagged Plane, Cube, Sphere (highlighted), Icosahedron, Capsule, Cylinder, Cone, Torus and TorusKnot; the pane shows Shape SphereGeometry, a SphereGeometry folder with radius 0.90, widthSegments 32 and heightSegments 16, Wireframe ticked, Vertices 561 and Triangles 960](reference.png)

## API

- `PlaneGeometry` (`width`, `height`, `widthSegments`, `heightSegments`): flat in x and y, facing +z.
- `CubeGeometry` (`width`, `height`, `depth`, `widthSegments`, `heightSegments`, `depthSegments`).
- `SphereGeometry` (`radius`, `widthSegments` slicing round +y, `heightSegments` banding from pole to pole).
- `IcosahedronGeometry` (`radius` to its corners, and `detail`, each step splitting every triangle into four).
- `CapsuleGeometry` (`radius`, `height` counting both caps, `radialSegments`, and `heightSegments`, which divides
  only the straight part).
- `CylinderGeometry` (`radiusTop`, `radiusBottom`, `height`, `radialSegments`, `heightSegments`, `openEnded`); a
  radius of 0 closes that end to a point.
- `ConeGeometry` (`radius`, `height`, `radialSegments`, `heightSegments`, `openEnded`): a cylinder with no top radius.
- `TorusGeometry` (`radius` to the tube's centre line, `tube` from there to its surface, `radialSegments`,
  `tubularSegments`, `arc` round the ring, and `thetaStart` and `thetaLength` round the tube).
- `TorusKnotGeometry` (`radius`, `tube`, `tubularSegments`, `radialSegments`, and `p` and `q`, the times it winds
  round +y and through the hole; 2 and 3 make a trefoil).
- `PlaneGeometryOptions`, `CubeGeometryOptions`, `SphereGeometryOptions`, `IcosahedronGeometryOptions`,
  `CapsuleGeometryOptions`, `CylinderGeometryOptions`, `ConeGeometryOptions`, `TorusGeometryOptions` and
  `TorusKnotGeometryOptions` type the options in `scene.ts`, less the `Geometry3DOptions` every geometry shares.
- `Geometry3D` `vertexCount` and `indices`: what the shape costs, shown as Vertices and Triangles;
  `geometry.destroy(true)` frees the old geometry and its buffers once the hero and its swatch draw the new one.
- `Mesh3D` with `geometry`, `material`, `position`, `rotation`, `scale` and `parent`: the hero and the swatch share
  one geometry, swapped on both. `Container3D` holds the row, which slides along x on a narrow view.
- `Vector3`, `PointData3D`, `hero.toLocal` with the `Camera3D`, and `view3d.worldToScreen` in `measures.ts` and
  `marks.ts`: lay each mark square to the view and push its tag clear of the shape.
- `View3D`: the 3D scene inside pixi's stage, and its `camera`.
- `OrbitCamera` from `@pixi/3d/extras`: drag to orbit, held within 30° of the front by `minAzimuthAngle` and
  `maxAzimuthAngle`, since the marks are laid out for a view from the front.
- `Application` from `pixi.js`; `Point` and `Rectangle` from `pixi.js` lay out the tags.

## Controls

- Drag to orbit, a little either side of the front.
- Pane: `Shape` picks the class. Its folder, named for the class, holds a row per option by the option's name;
  changing one builds a new geometry. `Wireframe` shows or hides the triangles, the read-only `Vertices` and
  `Triangles` count them, and `Reset` puts the class's options back.

## Files

- `index.ts`: the lesson. Each class's options, the one place each constructor is called, selecting and rebuilding.
- `scene.ts`: the class names, option types and colours, the hero's pose per class, and the row of swatches.
- `controls.ts`: the pane, with each option's teaching range and one folder per class.
- `visuals.ts`: the wireframe, the marks and the swatch tags, laid out again for each new geometry.
- `measures.ts`: what each class's options measure, and where their marks sit on the hero.
- `marks.ts`: the bars, arrows, arcs and ring that draw a size, and the tags that name them.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayMaterial`, `WireframeHelper`,
`AxesHelper`, `ArrowHelper`, `DimensionHelper`, `AngleHelper`, `PathHelper`, `LabelLayer`, `ThemePane`,
`LoadingScreen` and `fitPortrait`.

## See also

- [Geometry from arrays](../geometry_custom/README.md): a geometry of your own, built from typed arrays.
- [Vertex formats](../geometry_vertex-formats/README.md): how a geometry's vertices are stored.
- [Low-poly look](../materials_flat-shading/README.md): `flatShading`, one normal per triangle, on shapes of any
  detail.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_shapes` checks the example against it on WebGPU and WebGL; add `--update`
to retake it after an intended change.
