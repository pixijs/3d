# Mesh queries

Querying a mesh's triangles from your own code with `geometry.bvh`, a `TriangleBvh`: a tree of boxes round the
triangles, so a query tests the few near it rather than all of them. An orange ball rests on a clay terrain of 3,200
triangles beside a purple rock. Each frame a `raycast` straight down stands the ball on the terrain,
`closestPointToPoint` pushes it out of the rock, and `intersectsSphere` turns it pink while it touches. The tree works
in the geometry's own space, so every query moves its ray, point or sphere into the mesh's local space first and moves
the answer back to world space after; that conversion is the part to get right.

![A pale sky clay terrain of rolling hills floating over the light checker floor, every triangle's edges drawn over it in faint ink, an orange ball resting on it in the middle and a purple rounded octahedron, its edges drawn too, tipped over and sunk into the terrain behind it to the right; a pink arrow labelled raycast drops from high above straight through the ball to a pink dot on the ground under it, where the few triangles the ray tested show filled in pink through the ball, and a thin dark line runs from the ball's centre to a pink dot on the rock labelled closest point; the pane in the top right shows Ball radius 0.35, Triangles on, Visited boxes off, Total 4000, Tested 4 and Build time 0.0 ms](reference.png)

## API

- `Geometry3D` `buildBvh()` builds each mesh's tree up front, while loading, so the first frame doesn't wait for it;
  a build costs about 20 to 40 ms per 100,000 triangles. It returns `null` unless the geometry is a triangle list with
  `Float32Array` positions.
- `Geometry3D` `bvh`: read before each query. It returns the tree `buildBvh` made, refitted first after you edit the
  arrays in place and call `unload()` or `update()` on the position buffer, so reading it every time is cheap and
  keeps up with edits.
- `TriangleBvh` `raycast(ray)`: the distance along the ray to the closest triangle, front or back face, or `-1`. The
  distance is in the terrain's local units, so `Ray` `at` finds the hit on the local ray, and `Vector3`
  `applyAffineMatrix4` moves it to the world.
- `TriangleBvh` `closestPointToPoint(point, out)`: writes the rock's nearest point to the ball's centre into `out`.
  It returns the distance in the rock's units, which its scale of 1.7 stretches, so the push measures the gap again
  in world space and moves the ball out to one radius (`Vector3` `distanceTo`, `subtract`, `normalize`,
  `addScaledVector`).
- `TriangleBvh` `intersectsSphere(sphere)`: whether any of the rock's triangles lies within the ball; it stops at the
  first. `Sphere` `applyMatrix4` moves the ball's sphere into the rock's space, which works whole because the rock's
  scale is the same on every axis.
- `TriangleBvh` `traverse(intersectsBox, visitTriangle)` walks the tree, entering the boxes `intersectsBox` accepts
  and handing `visitTriangle` each triangle in them. Each frame it replays two queries' walks: the boxes the downward
  ray reaches before its hit (`Ray` `intersectBoxT`) and the boxes the ball's sphere touches (`Sphere`
  `intersectsBox`). The triangles in those boxes are the only ones the queries test. With Visited boxes on, the walk
  copies each `Box` it enters into one made up front, and the callbacks are made once, so it allocates nothing.
- `Matrix4`: each mesh's `getGlobalTransform` takes its local space to the world, and `getInverse` of it takes the
  world to its local space; `Ray` `applyMatrix4` moves the downward ray across. The terrain is lifted and the rock
  scaled, tipped and turned, so neither space is the world's.
- `Mesh3D` for the terrain, the rock and the ball, with `geometry`, `material`, `position`, `rotation`, `scale` and
  `parent`; the ball takes pointer events with `eventMode: 'static'`. `Container3D` types their parent.
- Dragging, in `scene.ts`: a level `Plane` through the ball's centre, and `View3D` `screenToWorld` on
  `globalpointermove` writes where the reader wants the ball. The ball rolls there in steps of half its radius, so it
  can't jump into the rock's middle, where the push would point the wrong way.
- `Geometry3D` built from `positions`, `normals` and `indices` for the heightfield; `View3D` and its `camera`;
  `OrbitCamera` from `@pixi/3d/extras`, kept above the sheet by `maxPolarAngle`; `Application` from `pixi.js`.

## Controls

- Drag the ball over the terrain; it rides the hills and slides round the rock. Drag anywhere else to orbit.
- Pane: `Ball radius` sizes the ball and the queries. `Triangles` draws every triangle's edges and fills in the ones
  the queries test. `Visited boxes` draws the boxes the downward ray enters in the terrain's tree and the boxes the
  ball's sphere enters in the rock's. `Total` counts both meshes' triangles, and `Tested` counts the ones the two walks
  reached this frame. `Build time` is how long the two `buildBvh` calls took (the example shots run on a frozen clock,
  so it reads 0.0 ms there).

## Files

- `index.ts`: the lesson. Building the trees, the matrices between each mesh's space and the world, the three
  queries, the walks that replay them, the pane and the frame loop.
- `scene.ts`: the heightfield terrain, the rock, the ball, and the drag that writes the ball's target.
- `visuals.ts`: each mesh's triangle edges and the pooled fills for its tested triangles, the ray and its hit, the
  nearest point and its line to the ball's centre, their labels, and the pooled box frames for the visited boxes. The
  edges, fills and frames are children of each mesh, so they sit in its local space.

From the theme kit (`examples/shared/theme/README.md`): `ThemeStage`, `clayGeometry`, `clayMaterial`, `ArrowHelper`,
`DotHelper`, `BoxHelper`, `WireframeHelper`, `TriangleHelper`, `LabelLayer`, `ThemePane`, `LoadingScreen` and
`fitPortrait`.

## See also

- [Raycast](../interaction_raycast/README.md): `view3d.raycast` from your own loop, which reads the same trees for
  `hitVolume: 'geometry'`.
- [Hit volumes](../interaction_hit-volumes/README.md): what picking by triangles costs next to a box or a sphere.
- [Geometry from arrays](../geometry_custom/README.md): building a heightmap's arrays, and rewriting them every frame.

The geometry guide's "Querying a mesh's triangles" section covers when the tree refits, rebuilds and is used by
picking.

## Reference image

`reference.png` is the page at 1280 × 720 on WebGPU and the light theme, 30 frames (0.48 s) after it comes up.
`npm run test:example-shots -- geometry_mesh-queries` checks the example against it on WebGPU and WebGL; add
`--update` to retake it after an intended change.
