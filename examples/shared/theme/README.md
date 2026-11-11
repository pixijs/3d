# Theme kit

The PixiJS 3D look in pieces any example can pick up: the loading screen, the light and dark checker stage with its
fog, the clay shapes, the palette, the logo, and the teaching visuals that draw the core of what an example shows. The
visuals come in two kinds: 3D helpers that draw the invisible in the scene (axes, arrows, angles, box frames, dots,
ghosts, paths, rings, spans, grids, points, wireframes, normals, struck triangles, bounding spheres, frustums, lights
and skeletons), and 2D overlays over the view: labels that name what the person couldn't otherwise pick out,
screen-space marks, and inset views, a second picture in a corner. Nothing here puts code, a chart or a diagram on
screen, or plays the lesson for the reader: the code carries the explanation, and the pane carries the values
(`examples/README.md`, "The picture shows the core"). The kit depends only on `pixi.js` and `@pixi/3d`: bring your own
`Application`, `View3D`, camera and UI, and take as many pieces as you want.

`examples/theme-kit.example.ts` uses the stage, clay, logo, pane and loading screen, and is the file to start a themed
example from. `examples/theme-kit-visuals/` shows every teaching visual, each on a clay subject with its name on it,
and its pane shows or hides each one. Examples import the kit by relative path, e.g. `ThemeStage` from
`examples/shared/theme/ThemeStage.ts`. There's no `index.ts` here, so the playground doesn't list the folder as an
example.

## Boot order

```ts
const theme = themeFromUrl(); // ?theme=light|dark, else 'light'
const loading = new LoadingScreen({ theme, label: 'Toy Box' }); // first, so the page is never blank
const app = new Application();

await app.init({ resizeTo: window, background: THEMES[theme].haze, antialias: true, autoStart: false });
loading.progress(0.2);

const view3d = new View3D({ autoResize: true });
const stage = new ThemeStage(view3d, { theme });
const logo = await loading.load(() => loadPixiLogo()); // the bar follows the downloaded bytes

app.stage.addChild(view3d);
view3d.root.addChild(logo.root);
app.ticker.add((ticker) => stage.update(ticker.deltaMS / 1000));
app.render(); // the canvas joins with its first frame drawn
document.body.appendChild(app.canvas);
await loading.finish();
app.start();
```

## palette.ts

Colours only, as they show on screen.

- `BRAND`: the brand pink, purple, sky, orange and white, the logo's face pink, `hotPink` for glows and flashes,
  `ink` and `night`.
- `CLAY` has the eight clay tints by name (`CLAY_COLORS` in material-slot order), and `CLAY_WEIGHTS` how often each
  turns up in a crowd. `DARK_ORANGE` is the amber that orange clay turns to on the dark theme, for an orange baked
  once (a vertex colour, a texture) that has to hold on both themes.
- `THEMES.light` and `THEMES.dark` hold the stage's `haze` (the horizon and the fog), `sky`, `floor` and `check`
  colours, and the `ink` and `inkSoft` for text drawn over it.
- `themeFromUrl(fallback)` reads `?theme=`. `mixColor(a, b, t)`, `cssColor(color)` for page styles, and
  `screenColor(color)`, the colour to give a flat fog or background so it shows as `color`; the view decodes and
  encodes with the same 2.2 gamma, so today it returns `color` unchanged.

## ThemeStage.ts

`new ThemeStage(view3d, options)` sets the scene up for a theme: a checker floor at y = 0 that takes real shadows and
melts into fog, a backdrop that meets the fog at the horizon, and the fill, key and form lights. It needs no post
pass; the backdrop is the view's hemisphere background.

- Options: `theme`, `at` (the floor's height), `size` (160; keep its edge past the fog), `check` (one check's side,
  1), `roughness` (0.85), `fog` (`{ near, far }`, 12 to 40; pick `far` for your camera distance), `spotlight`
  (`true` or `ThemeSpotOptions`: a spotlight pool that fades in on the dark theme), and `reflections`.
- `lights: false` leaves the key and form lights out of the view, for an example that brings its own lighting: the
  floor, fog, backdrop and hemisphere fill stay, and so does `spotlight` if asked for. `form: false` leaves out only
  the form light, which shows on the dark theme alone; its second highlight on a sphere can read as a stronger
  reflection. `stage.key` and `stage.form` exist either way, outside the scene, so code that reads them still runs.
- It sets the view's `environment`, `background` and `fog` to its own objects, `toneMapping` to `'none'`, which the
  palette is picked for, and `shadowFilter` to `'pcf-high'` for soft shadow edges (set `'pcf'` after it to save
  shadow reads on a busy phone scene).
- `reflections` swaps the hemisphere fill for a cube map, for materials that mirror their surroundings: metals,
  clearcoat, sheen. `loadReflections()` loads the kit's, a greyscale sunset, so a metal tints it with its own colour.
  It lights the same on both themes.
- The key's shadow box fits the shadow casters every frame, the engine's default, so every texel of the map lands
  on them. Set `stage.key.shadow.bounds` to a `Box` to pin it instead: past 256 casters, where the engine stops
  re-measuring, or when one far-off caster would stretch it.
- An engine bug cuts that fitted box's shadows short: floor past the caster furthest from the key reads as lit, so a
  shadow that falls behind its caster is cut off along a line. Until it's fixed, `stage.shadowOverFloor()` works
  round it: it refits the key's box on every `update` to the view's shadow-casting meshes and the floor their shadows
  fall on. Pass it world `Box`es for instances or dynamic geometry, which the walk can't measure. Examples whose
  shadows reach past their casters call it.
- `stage.setTheme('dark', 0.6)` fades over 0.6 s, advanced by `stage.update(dt)` each tick; 0 switches at once.
  `stage.darkness` (0 light to 1 dark) sets any point between them, e.g. for a day-night cycle, or to keep a second
  stage on the first one's theme: copy the first stage's `darkness` onto the inset's stage each tick.
- `stage.floor` (set its `eventMode` to pick taps), `floorMaterial`, `key`, `form`, `spot`, `fill`, `backdrop` and
  `fog` are there to adjust. A theme change writes over the lights and colours; `fog.near` and `fog.far` stay yours.
- `stage.destroy()` removes the floor and lights, in the scene or not, and clears the view's environment, background
  and fog if they're still the stage's.

```ts
const stage = new ThemeStage(view3d, { theme, lights: false, fog: { near: 10, far: 30 } });
const lamp = new PointLight({ color: BRAND.sky, intensity: 25, range: 8 }); // the example's own light

view3d.root.addChild(lamp);
toggle.on('pointertap', () => stage.setTheme(stage.theme === 'light' ? 'dark' : 'light', 0.6));
```

A stage costs two draws, the floor and the backdrop, and a shadow pass for the key; `lights: false` drops the shadow
pass, since no light casts, unless `spotlight` is on: the spot still joins the view, and casts once the dark theme
lights it.

## shapes.ts and clay.ts

The seven rounded clay shapes (`CLAY_SHAPES`: cube, capsule, sphere, puck, pyramid, octahedron, torus), each about a
unit across, and matte clay with a pale sheen to wear them.

- `clayGeometry(shape, detail?)` is shared and cached: `'high'` (default) for shapes people look at, `'low'` for
  crowds of thousands. Every shape has its bounds set, so `hitVolume: 'geometry'` works.
- `clayMaterial(color, { extraBits, alphaMode, alpha, doubleSided })` is shared and cached per colour (a
  `ClayColor` or any hex) and per look: `alphaMode: 'blend'` with `alpha` (rounded to 0.01) for see-through clay,
  `doubleSided: true` for a plane's back or the inside of an open shape, `extraBits` for your own shader bits.
- `createClayMaterial({ color, baseColorTexture, extraBits, emissive, alphaMode, alpha, doubleSided })` builds one of
  your own, not shared: one per toy with its own painted texture, or glowing clay. `emissive` is the engine's group
  (`{ color, strength, texture }`); the clay keeps its roughness and sheen under it, and `material.emissive.strength`
  stays writable, so a hit can light it. Passed `emissive`, it returns a `GlowingClayMaterial`, whose `emissive` is
  always there.
- Every clay material the kit makes follows the stage while it lives, shared or your own: less sheen in the dark, and
  orange brightens to `DARK_ORANGE` (dark orange reads as brown). Your own one stops following when you destroy it.
- `roundedBox(width, height, depth, radius)` and `roundedCylinder(radius, height, edge)` build clay at any size.
- UVs are unique across each surface, for painting at `hit3D.uv`; `CLAY_UV_LAYOUT` and `CLAY_UV_ASPECT` describe
  them.

```ts
const batch = new BatchedMesh3D({ size: 300 });
const lamp = createClayMaterial({ color: 'purple', emissive: { color: BRAND.hotPink, strength: 0 } });

batch.setGeometryAt(i, clayGeometry('torus'));
batch.setMaterialAt(i, clayMaterial('lilac'));
shell.material = clayMaterial('sky', { alphaMode: 'blend', alpha: 0.45 });
lamp.emissive.strength = 1; // lights it, in either theme
```

Clay costs what any material does: meshes that share a clay geometry and material draw as one instanced run, and the
options add none: see-through clay draws in the transparent pass after the opaque scene, sorted back to front, and
two-sided clay is still one draw.

## logo.ts, EnamelMaterial.ts and wordmark.ts

`loadPixiLogo(options)` loads `LOGO_URL`, the manifest's `pixijs.Logo` model, and splits it into its five pieces (`LOGO_PIECES`: `p`,
`ixi`, `dotL`, `dotR`, `js`), each on a pivot at its own centre, so `logo.pieces.js.pivot` turns and squashes about
itself; `piece.rest` is where it sits in the assembled logo.

- `width` (4), `castShadow` (true), `receiveShadow` (false), and `material`: `'enamel'` (default) gives each piece
  its own `EnamelMaterial` in `logo.enamel`, `'source'` keeps the model's.
- `logo.setMaterial(material)` re-skins every piece, or `logo.setMaterial((id, mesh) => …)` each one; materials you
  pass stay yours. `logo.pointOn(id, x, y, out)` is a point on a piece's front face, for hits and glints.
- `EnamelMaterial` is the logo's lacquered pink, with `glow` (a hit, 0 to about 1.4), `heat` (a deeper neon pink) and
  `reflections` (0.2 under the stage's hemisphere; raise it under a dark cube map). Fog is off, so the logo keeps its
  colour in a hazy scene.

The 2D wordmark comes as SVG markup (`wordmarkSvg`, which the loading screen uses) and as a white
`wordmarkContext()` to tint, drawn at `WORDMARK_SIZE`:

```ts
const badge = new Graphics(wordmarkContext());

badge.tint = BRAND.pink;
badge.scale.set(28 / WORDMARK_SIZE.height); // 28 px tall
```

## monitor.ts

`createMonitor(options)` builds a clay monitor: a rounded bezel round a screen plane that shows whatever material you
give it, and so any texture, such as a `ContainerTexture`, a camera's render texture or a video. It has no stand: it
floats like the logo, and its shadow on the floor grounds it.

- `material` (required) is the screen's: a `FlatMaterial` with `fog: false` shows the texture exactly as drawn, a
  powered screen; a lit material shades it. `width` (3) and `aspect` (16 / 9; pass the texture's) size the screen,
  and the bezel's rim and depth follow the width. `flipV` puts v = 0 on the top edge, for a texture stored top row
  first (a video, a render texture). `color` is the bezel's clay (`'lilac'`).
- `monitor.root` has its origin at the screen's centre, with the screen facing +z and the bezel behind it: position
  and turn the root. `monitor.screen` is the plane (swap its `material` to show something else), `monitor.bezel` the
  clay, and `monitor.size` the screen's width and height in world units, for mapping texture pixels onto it.

```ts
const monitor = createMonitor({
  material: new FlatMaterial({ baseColorTexture: texture, fog: false }),
  width: 3.2,
  aspect: texture.width / texture.height,
});

monitor.root.position.set(0, 1.9, 0);
view3d.root.addChild(monitor.root);
```

A monitor is two draws, the bezel and the screen, and the bezel's shadow.

## ThemePane.ts

`new ThemePane({ title, stage })` is the examples' control panel: a [Tweakpane](https://tweakpane.github.io/docs/)
pane in the top-right corner, painted in the theme's colours, whose first row switches the stage between light and
dark (a 0.6 s fade; `fade` changes it). Bind the example's own values under it with Tweakpane's addBinding,
addFolder and addButton.

- It opens collapsed on a screen under 600 px wide or under 500 px tall (a phone held sideways); `expanded`
  overrides that.
- `top` (12) is its distance from the top of the page in CSS px, so an example's own top-right panel keeps the
  corner.
- `pane.flash(row)` tints a row's name accent for 1.5 s, then fades it back over 0.4 s, so a reader sees which row a
  change of theirs moved: a row whose value the code wrote when another row changed. It takes what `addBinding`,
  `addButton` or `addFolder` returned; a second flash restarts the hold. Call `row.refresh()` first, so the row shows
  the value the code wrote.
- Read-only monitors write in the labels' monospace font, so a multi-line log (`multiline: true, rows: 4`) lines its
  columns up.
- It sits under the loading screen, and `dispose()` removes it from the page and stops any flash.

```ts
const pane = new ThemePane({ title: 'Shadows', stage, top: 116 });
const bias = pane.addBinding(stage.key.shadow, 'bias', { min: 0, max: 0.01 });

pane.addBinding(settings, 'cascades').on('change', () => {
  stage.key.shadow.bias = settings.cascades ? 0.002 : 0.005;
  bias.refresh();
  pane.flash(bias);
});
```

## fitPortrait.ts

`fitPortrait({ renderer, orbit, stage, minAspect })` keeps the subject whole on a phone held upright. Frame the
scene for landscape, then give it `minAspect`, the narrowest width over height that still shows the subject whole
from there. On a narrower view it scales the camera's distance, the orbit's `minDistance` and `maxDistance` and the
stage's fog by `minAspect / aspect`, and it follows the renderer's resizes, so a phone turned after load refits. Call
it once the camera is placed and the orbit built.

- The aspect is the rect the camera's viewport fills: the whole view, or half of it in a split screen. A view of
  your own size (not `autoResize`) is measured at its own size.
- `orbit` is an `OrbitCamera`, or `{ view, target }` for a camera with no orbit: it moves along its line to
  `target`. `stage` is optional; without one no fog scales.
- `clearTop` and `clearBottom` (px, 0): on a view narrower than `minAspect` that fills the screen, those bands stay
  free for panels, and the orbit target lands at the middle of the band between them. The fit does it by growing
  the view taller than the screen and shifting it (`view3d.setSize`, `view3d.position`), so the picture stays
  seamless, and gives a wide view its `autoResize` back. A `LabelLayer` over the view then needs
  `bounds: app.screen`.
- `minHeight` (0 to 1, 0 off): the share of the landscape view's height the subject fills. With clears, a narrow
  view also backs off until that much fits the band, for a band shorter than the subject.
- It returns `{ clearTop, clearBottom, refit(), stop() }`. Set the clears there when a panel's size is known only
  later, then `refit()`; `refit()` too after changing the camera's viewport or a view's own size. `stop()` stops
  following resizes.

```ts
view3d.camera.position.set(0, 3.2, 10);

const orbit = new OrbitCamera({ view: view3d, target: { x: 0, y: 1.2, z: 0 }, maxDistance: 16 });
const labels = new LabelLayer({ view3d, stage, bounds: app.screen });
const fit = fitPortrait({ renderer: app.renderer, orbit, stage, minAspect: 1.35, clearTop: 88 });

fit.clearBottom = inset.rect.height + 32; // the inset docks at the bottom on a phone
fit.refit();
```

## Helpers

Arrows, axes, angles, box frames, dots and ghosts that draw a concept in the scene: a node's own axes, an offset, a
turn, a size, a hit point, a pose before a change. They're light, not clay: flat colour with no shading, shadows or
fog, so a reader never takes one for part of the scene, and they never join the pick list. Each is a `Container3D`
(pass `parent`, `position` and the rest as usual) in its own file, `ArrowHelper` from `ArrowHelper.ts` and so on.

Every helper extends `Helper` (`Helper.ts`) and takes the same look options, at construction and as properties after:

- `color`: an axis (`'x'` red, `'y'` green, `'z'` blue), `'ink'` (the theme's soft text colour), `'accent'` (the
  brand's hot pink), `'haze'` (the scene's background, for a rim that parts a mark from what's behind it) or any hex.
  `'ink'` and `'haze'` follow the stage. Setting `color = 'accent'` and back is how a helper lights up.
- `opacity` (1). Writing it every frame is how a ghost fades.
- `xray` (false): draws after the opaque scene with no depth test, so it shows through whatever is in front, such as
  axes inside a door slab.
- `muted` (false): the quiet look, see-through ink at 0.3, for a helper that isn't the point right now. `color` and
  `opacity` are kept for when it comes back.
- `pass` (null): draws in that `MeshPass` only, an InsetView's (`pass: inset.pass`), and not in the main view. A pass
  draws solid: see-through parts (a wedge, a fill) and camera-facing ones (a dot's rim) hide, `muted` draws solid ink,
  and `'ink'` flips with the theme at mid-fade. Keep a pass helper's colour steady: each colour is a shader there.

The helpers:

- `new AxesHelper({ length, thickness, parent: node })`: the node's own x, y and z as arrows from its origin, with a
  dot at the point it turns about. As the node's child it turns and scales with it. `axes.tips` are the arrow ends,
  for labels, and `xAxis`, `yAxis`, `zAxis` the arrows. The arrows and dot keep their colours; `muted`, `opacity`,
  `xray` and `pass` reach all of them.
- `new ArrowHelper({ color, thickness, head })` and `arrow.set(from, to)`, both in the parent's space: an offset, a
  direction or a vector. `head: false` draws a plain line. `thickness` is settable and redraws the last `set`.
  Default colour `'accent'`.
- `new AngleHelper({ radius, thickness, color, wedge, head })`, then `angle.setAxis(axis, from)` and
  `angle.radians = value`: an arc, a see-through wedge and a head, at the point something turns about. A positive value
  sweeps the way a positive rotation about `axis` turns. `radius` and `thickness` are settable; the arc is rebuilt in
  place only when one of the three changes. `head: false` ends the arc plainly, `wedge: false` leaves the fill out.
- `new BoxHelper({ color, thickness, fill })` and `frame.setBox(box)`: a box's twelve edges, laid just outside it so a
  model that fills it shows whole. `fill` (0, settable) is the opacity of see-through faces; 0 hides them.
- `new DotHelper({ radius, color, outline })`: a flat dot marking one point, a hit point, an aim target.
  `radius` (0.06, settable) sizes the dot itself, not the node, so an arrow or a label under it stays in the parent's
  units and hides with it. It's in the parent's units, so a scaled parent grows it (a `PointsHelper`'s dots don't).
  `outline: true` rings it in `'haze'`, so an accent dot still shows on a pink surface. A dot on a surface sits half
  inside it, so an outlined dot also turns `xray` on unless you pass it: the dot and its rim draw whole over the
  scene, and show through whatever is in front. Default colour `'ink'`.
- `new GhostHelper({ source, opacity })`: a see-through ink copy of `source`'s meshes (helpers skipped), for "before"
  in a before and after. It shares each geometry and starts at the source's `position`, `quaternion`, `scale` and
  `origin`, which are then yours to write. `opacity` (0.22) can fade every frame. It draws in the main view only.

```ts
const axes = new AxesHelper({ length: 1.2, parent: letter });
const turn = new AngleHelper({ radius: 1, position: letter.position, parent: view3d.root });
const hit = new DotHelper({ color: 'accent', outline: true, parent: view3d.root });

// The letter's pose now, left behind as it turns.
new GhostHelper({ source: letter, parent: view3d.root });

turn.setAxis({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
app.ticker.add(() => {
  turn.radians = letter.rotation.y;
  axes.muted = !showAxes;
  hit.position.copyFrom(lastHit);
});
```

Draw calls: an arrow 2, axes 7 on WebGPU and 3 on WebGL, an angle 3 (2 without the wedge, one less without the head),
a box 1 (2 with a fill), a dot 1 (2 with the rim), a ghost 1 per mesh it copies. WebGL draws every part on the same
kit geometry in one call whatever its colour, so axes are 3 there and two arrows in different colours still 2. WebGPU
draws such a run once per colour, and as one only past 16. A hidden part still costs WebGPU an empty draw, so a box
is 2 there with or without a fill. Colour, opacity, muted and x-ray changes swap cached materials or write the
helper's own in place, and add none to a helper on its own; on WebGPU, a new colour on one of several helpers that
share a geometry adds one. Draw what the lesson is about, not every node.

### Building your own

`helpers.ts` holds what the helpers share, and the pieces for one of your own:

- `helperMaterial(color, opacity, xray, pass)`: the flat material every helper draws with, shared and cached per
  colour, opacity (to 0.01), x-ray and pass. Under 1 it blends and draws both sides. `ghostMaterial()` is
  `helperMaterial('ink', 0.22)`, for a mesh you copy yourself:
  `new Mesh3D({ geometry: mesh.geometry, material: ghostMaterial(), castShadow: false })`.
- `createHelperMaterial({ color, opacity, xray })` (`HelperMaterial.ts`): a material of your own, not cached, with a
  settable `color` and `alpha` written in place, for a colour that follows a picker or a fade. It follows the theme
  while it's alive; `destroy()` it when you're done.
- `helperColor(color)`: a helper colour as it shows on the current theme. `helperGeometry('shaft' | 'head' | 'dot' |
'bar')`: the kit's arrow shaft and head, dot sphere and unit cube. `sharedHelperResource(key, create)`: a geometry
  or texture your helper module shares, kept and freed by the kit.
- `new BarsGeometry(capacity)` (`BarsGeometry.ts`): thin six-sided bars between point pairs in one dynamic geometry,
  the line most helpers draw with. `bars.setBar(i, ax, ay, az, bx, by, bz, radiusA, radiusB)` writes one in place (a
  `radiusB` of 0 is a cone, for an arrow head in the same draw), `bars.count` is how many are in use, and
  `bars.update()` uploads them. Its index count never changes, so dropped bars collapse to nothing in place. Its
  `destroy()` frees its buffers too, since no other geometry shares them.
- A class that extends `Helper`: call `super(options, defaultColor)`, add meshes with
  `this._addPart(geometry, shade, color)` (`shade` scales the opacity, `color` overrides the helper's), show and hide
  them with `this._showPart(mesh, shown)`, change a part's shade with `this._setShade(mesh, shade)`, and destroy the
  geometry you built in `destroy()`. The base paints every part for `color`, `opacity`, `xray`, `muted` and `pass`.

```ts
const bars = new BarsGeometry(64);

bars.setBar(0, 0, 0, 0, 1, 0, 0, 0.02);
bars.setBar(1, 1, 0, 0, 1.2, 0, 0, 0.06, 0); // an arrow head on the line's end
bars.count = 2;
bars.update();
```

A pass helper's `MeshPass` needs no options of its own: InsetView builds a plain `new MeshPass({ name, camera })`, and
each helper's pass material brings its solid shader.

## PathHelper.ts, RingHelper.ts, DimensionHelper.ts and GridHelper.ts

Lines you place in the scene: a path or a trail through points, a ring at a hit point, a measured span, a grid. Each
is one geometry of thin six-sided bars (a `BarsGeometry`, or for a ring one closed tube), so a line reads as a line
from any side, drawn in one call however many curves, dashes or ticks it holds. They're helpers like the others: flat
helper colour, no shading, shadows or fog, never picked, and `color`, `opacity`, `muted`, `xray` and `pass` work on
each. Their points are in the parent's space.

- `new PathHelper({ color, thickness, capacity, closed, dash, gap, taper, head })` draws a line through points. The
  colour is `'ink'` by default, `thickness` 0.02. Its bars are written in place, so a path set every frame allocates
  nothing until it needs more bars than it has ever held; then it grows once.
  - `path.setPoints(xyz, count?)` takes `count` points, three numbers each, from any array you keep (a reused
    `Float32Array`). A point whose `x` is NaN lifts the pen, so one path draws many curves in one draw: fifteen ghost
    paths, two waves.
  - `path.setSegments(xyz, count?)` draws separate segments, a pair of points each: ticks, edges, spokes, stems.
  - `path.push(point, minStep = 0)` adds a point to the end, for a trail, and drops the oldest once it holds
    `capacity` points (64), so `capacity` sets the trail's length. A point within `minStep` of the last is skipped,
    so the spacing doesn't follow the frame rate. `path.clear()` empties it, and an empty path hides.
  - `closed: true` joins each curve's last point back to its first (never a segment's). `PathHelper.circle(radius,
segments = 48, out?)` returns points round local +y in the xz plane, from +x the way a positive `rotation.y`
    turns, for a ring: an orbit, a floor circle.
  - `dash` is a dash's length along the line, in the parent's units (0, solid), and `gap` the space after it (the
    dash's length). The pattern runs on along each curve through its points, so a curve of short steps still dashes
    evenly. `taper: true` narrows the line to nothing at its oldest point, for a trail.
  - `head: true` ends each curve in an arrowhead, sized from `thickness` like `ArrowHelper`'s. It takes the curve's
    last stretch, so the line stops where the head starts, and it stays solid on a dashed line. `head` and `closed`
    act on every curve of a path: `setSegments` spokes each get a head.
  - `path.thickness = …` rewrites it in place, for a resize such as a phone's narrower view.
- `new RingHelper({ radius, thickness, segments, color })` draws a flat ring in its own xz plane, square to its +y:
  a tap's landing point, a brush cursor, a found shape's halo. `radius` (0.3) is to the middle of its line,
  `thickness` 0.03, the colour `'accent'` by default. It rests on its plane rather than straddling it, so on a floor
  it shows whole. `ring.place(point, normal)` moves it onto `point` and turns it to lie on the surface whose normal
  is `normal` (any length): `ring.place(hit.point, hit.normal)`. `radius` and `thickness` can change at any time;
  each rewrites the ring in place and leaves the other be. For a pulse, scale the ring. Its `segments` (48) share
  their ends, so the ring runs unbroken, with no notch at a joint seen face on and no bead when it's see-through.
- `new DimensionHelper({ color, thickness, tick, divisions, ticks, across })` draws a span like a technical
  drawing's: a bar between two points, a tick square to it at each end, `tick` long (0.12), and shorter ticks,
  half as long, between. `dimension.set(from, to)` places it, and rebuilds only when an end or a setting changed
  since the last call, so calling it every frame is cheap.
  - `divisions` (1) splits the span into equal parts with a short tick between each; `ticks`, fractions 0 to 1
    along the span, puts them where you say instead (a capsule's straight part, a ruler's marks).
  - The ticks stand along `across` (+y), squared to the span. A span that runs along it falls back to +x, then +z,
    so a vertical height's ticks stand along x and read from a camera in front, where +z ticks would point at it
    and shrink to nubs. `divisions`, `ticks` and `across` (a `Vector3`: copy into it) are read on the next `set`.
  - `dimension.middle` is the span's middle, for its tag: `labels.add({ text, node: group, at: width.middle })`, then
    `tag.at.copyFrom(width.middle)` after a `set` that moved it.
- `new GridHelper({ size, step, color, lines, outline, thickness })` draws a flat grid on its xz plane, centred on
  its origin, resting 0.002 above it so it never fights a floor at the same height. `size` (4) is one number for a
  square or `{ width, depth }`; its lines run at multiples of `step` (1) from the centre. `lines` (0.35) is the inner
  lines' share of the grid's opacity, and `outline: true` draws the edge at its full opacity, so `grid.opacity = 0.5`
  halves both and `muted` comes back to them. `size` and `step` can change, each rebuilding the grid once, and
  `lines` too. Number its lines with LabelLayer labels at multiples of `step`; `thickness` is 0.01.

```ts
const ring = new PathHelper({ closed: true, thickness: 0.015, parent: orbitPivot }).setPoints(PathHelper.circle(2.5));
const trail = new PathHelper({ color: 'accent', thickness: 0.05, capacity: 90, taper: true, parent: view3d.root });
const jump = new PathHelper({
  color: 'accent',
  thickness: 0.03,
  dash: 0.1,
  gap: 0.07,
  head: true,
  parent: view3d.root,
});
const tap = new RingHelper({ radius: 0.2, color: 'ink', parent: view3d.root });
const width = new DimensionHelper({ divisions: 4, parent: group });
const board = new GridHelper({ size: { width: 6, depth: 4 }, step: 0.5, parent: view3d.root });
const arc = new Float32Array(24 * 3); // the jump's points, rewritten each frame

app.ticker.add(() => {
  trail.push(planet.position, 0.04);
  jump.setPoints(arc);
  width.set(left, right); // rebuilds only when an end moved
  if (hit) tap.place(hit.point, hit.normal);
});
```

Each is one draw call, a `GridHelper` two with its outline; a dashed path, a path of many curves and a trail are still
one.

A see-through path shows a darker bead at each point where two of its bars meet, since each bar's end caps draw
inside the next. That includes `muted`, which is see-through ink at 0.3, so every muted path beads, at every bend of a
zigzag and every point of a curve. A thinner line makes them fainter but doesn't remove them; until `BarsGeometry` can
leave out the caps inside a line, a path that must read clean stays at full opacity.

## WireframeHelper.ts, NormalsHelper.ts, TriangleHelper.ts and SphereHelper.ts

Helpers that trace a mesh or a hit volume: its triangle edges, its normals, the triangle a ray struck, a bounding
sphere. They're helpers like the others: flat helper colour, no shading, shadows or fog, never picked, and `color`,
`opacity`, `muted`, `xray` and `pass` work on each. Add the first three as the mesh's child, so they read the
geometry in its own space and move with it.

- `new WireframeHelper({ geometry, lift, thickness, color })` draws every triangle edge once, however many triangles
  share it: edges whose two ends sit at the same positions count once, so a cube's 24 vertices give 18 bars, its 12
  edges and a diagonal across each face. Positions within a millionth of the shape's size count as the same, so a
  round shape's seam, whose vertices repeat the first ring a rounding error off, draws once too. Give it a
  `geometry`, or `positions`, `indices` and `normals` arrays (`indices` left out takes every three vertices in order).
  Each end stands `lift` (0.004) off the surface along the normals there, averaged where vertices share a position,
  so the bars never fight the faces; without normals nothing lifts. The colour is `'ink'` by default.
  - `update()` moves the bars after the positions or normals were rewritten in place, with no search and no
    allocation, so a surface that ripples every frame keeps its wireframe. It keeps the arrays it was given, not the
    geometry.
  - `rebuild(positions?, indices?, normals?)` outlines a new shape: it finds the edges again, which allocates, and
    grows its buffers only when the new shape has more edges than any before. Each array left out is the one it
    already holds, so `rebuild()` alone finds the edges again after you rewrite the indices in place.
  - `thickness` is each bar's width (0.012), settable: a dense mesh reads better with thinner bars.
  - `edgeCount` and `triangleCount` say what it drew, for a tag.
- `new NormalsHelper({ geometry, length, thickness, color })` draws a short hair out of each vertex along its normal,
  `length` long (0.3) whatever the normal's length, `thickness` wide (0.012). It reads float normals, three a vertex,
  and the `Int16Array` with four a vertex that a default (quantized) geometry stores. Give it a `geometry`, or
  `positions` and `normals` of your own: a slice through a mesh, the normals blended at a hit. `update()` re-reads
  them after you rewrite them in place; `length` can change at any time.
- `new TriangleHelper({ color })` and `triangle.set(a, b, c)` fill one triangle, corners in the parent's space, read
  straight from the geometry at `hit.triangleIndex`. It sits 0.004 off the face toward the triangle's front (the
  side its corners run anticlockwise round) and draws from both sides. The colour is `'accent'` by default. An
  outline-only triangle is a closed `PathHelper` through the three corners.
- `new SphereHelper({ camera, thickness, fill, color })` and `sphere.setSphere(volume)`, a `Sphere` in the parent's
  space, draw its outline: a ring on the sphere's edge as the camera sees it, and a ring round its equator, both just
  outside the radius so a ball that fills the sphere shows whole. Give it the view's `camera` and call `update()`
  each frame, after the camera moves: that turns the outline to the camera and fits it to the circle where the
  camera's sight lines graze the sphere, so it hugs the sphere anywhere in the view, close up too. From inside the
  sphere the outline hides. `fill` (0) is the opacity of a see-through sphere inside, settable every frame. The rings
  are rebuilt only when the radius changes, so calling `setSphere` every frame on a moving sphere is cheap. Centred on
  the floor, the floor hides its lower half and it reads as a dome, for a trigger zone. Without a `camera` the outline
  faces the camera's axes rather than its position, so off the middle of the view the sphere spreads past it (about
  8% of the radius at 23° off the middle).

```ts
const wire = new WireframeHelper({ geometry: hero.geometry, parent: hero });
const hairs = new NormalsHelper({ geometry: terrain.geometry, length: 0.2, parent: terrain });
const struck = new TriangleHelper({ parent: torus });
const volume = new Sphere(new Vector3(2, 0, 1), 1.2);
const zone = new SphereHelper({ camera: view3d.camera, fill: 0.14, parent: view3d.root }).setSphere(volume);

wire.rebuild(next.positions, next.indices, next.normals); // a new shape: new edges

app.ticker.add(() => {
  hairs.update(); // the terrain rewrote its positions and normals in place
  struck.set(a, b, c); // the corners of the triangle the ray struck
  zone.color = volume.containsPoint(player.position) ? 'accent' : 'ink';
  zone.update(); // after the orbit moved the camera
});
```

A `WireframeHelper`, `NormalsHelper` and `TriangleHelper` are one draw each. A `SphereHelper` with a `camera` is one,
since its outline and equator share a ring, and two without one, where the outline faces the camera on its own; a fill
adds one. WebGPU keeps an empty draw for the hidden fill, so there it's two with a camera and three without, fill or
not. Every bar costs twelve vertices drawn or not, so a wireframe of a 20 000-triangle mesh, 30 000 edges, is one
draw of 360 000 vertices: keep the meshes you outline small. In a `pass` the sphere's fill hides, since a pass draws
solid parts only, and so does its outline unless it has a `camera`: give it the camera that pass draws for.

## PointsHelper.ts and particles.ts

Round flat dots at many points in one draw: a mesh's vertices, beads along a path, keyframes, points baked on a
surface, rings round traced sparks. Each point is a camera-facing quad in one `ParticleContainer3D`, so 20 000 points
cost one draw, where spheres would cost millions of triangles. It's a helper like the others: flat helper colour, no
shading, shadows or fog, never picked.

- `new PointsHelper({ positions, capacity, radius, hollow, color, ...helper options })`. `positions` is any typed
  array of x, y, z in the helper's space, and the helper keeps it: write it in place. To mark a mesh's vertices, pass
  its `geometry.positions` and add the helper as the mesh's child. `capacity` is the most points it draws at once
  (every point in `positions` by default), `radius` each dot's radius in world units (0.04): particles size in world
  space, so a scaled parent doesn't grow the dots the way it grows a `DotHelper`. `hollow: true` draws a ring round
  each point, its line a fifth of the radius, for marking something that sits inside it. The colour is `'ink'` by
  default.
- `first` and `count` pick the run it draws, points `first` to `first + count − 1`: a sliding window, the points
  born so far, the strip under a ruler. `count` starts at `capacity`. Both clamp to what's there, and `count` reads
  the points it draws: with 40 points, `first = 38` and `count = 10` it reads 2, and reads 10 again once `first`
  moves back. `radius` can change too.
- `update()` writes the run to the GPU in one upload. It draws the points as they are when it's built; after that,
  call `update()` on the frames you wrote `positions` or changed `first`, `count` or `radius`, and skip it otherwise.
  It can't tell whether `positions` changed, so every call uploads.
- `color`, `opacity`, `muted` and `xray` work like any helper's and show at once, with no `update()`. An `'ink'` one
  follows the theme by itself. `pass` doesn't apply: particles only draw in the main view.
- Each dot stands a dot's width toward the camera, along its own line of sight, so it lands on the same pixels and a
  dot on a surface draws whole instead of sinking halfway in. A surface turned more than about 60° from the camera
  can still clip the edge of a dot; `xray` draws them all. Under an orthographic camera a dot can shift by a small
  fraction of its own size.

particles.ts holds what the particle examples share:

- `sparkTexture()`: the kit's particle sprite, a soft white dot (the engine's default particle is a white square).
  Tint it with the particle's colour; a tint shows as written, so pass palette colours as they are.
- `pointTexture(hollow)`: the disc or ring `PointsHelper` draws, for a `ParticleContainer3D` of your own.

```ts
const dots = new PointsHelper({ positions: geometry.positions, radius: 0.03, parent: mesh });
const run = new PointsHelper({ positions: path, capacity: 10, radius: 0.06, color: 'accent', parent: view3d.root });
const sparks = new ParticleSystem3D({ texture: sparkTexture(), color: BRAND.pink });

app.ticker.add(() => {
  run.first = (run.first + 1) % 48; // ten beads sliding along the path
  run.update();
});
```

A `PointsHelper` is one draw call at any count, and its points cost four vertices each, drawn or not, so size
`capacity` to what you show.

## FrustumHelper.ts

`new FrustumHelper({ camera, view, length, parent })` draws a camera's view volume, cut short, with a small camera
glyph (a box with a lens) behind its eye: where a camera stands and what it sees. It copies the camera's world pose
into its parent's space, so it draws any camera from anywhere: the view's own camera seen from an inset, a camera in
another view's scene, or a lone `Camera3D` that only draws into a texture. A perspective camera's volume is a pyramid
from the eye, an orthographic one's a box of half-width `orthographicSize / zoom`.

- `frustum.update()` each frame, once the camera has moved. It reads the camera's pose with `getGlobalTransform`, so
  it's right before the first render and for a camera whose scene isn't drawn, then its projection through
  `camera.computeProjection`, and the aspect. It places itself at that pose and rebuilds its bars only when the shape
  changes, so a camera that only moves costs no upload. Don't add it under the camera: it places itself.
- The aspect is the camera's `renderTexture`'s, else the camera's `viewport` rect of `view`, else `aspect` (1). With
  `view`, the volume follows the view's resizes, so a phone held upright shows a tall, narrow one. An `autoResize`
  view reports 256 × 256 until its first render takes the screen's size, so the frame the loading screen dissolves
  onto would show a square volume: build it with the screen's size too,
  `new View3D({ autoResize: true, width: app.screen.width, height: app.screen.height })`. That puts the first
  frame's labels in place as well.
- `length` (2) is how far the volume runs along the camera's forward axis, from the eye to the end. `floor` (`null`)
  is a height, in the parent's space, that the edges run down to instead, outlining the footprint where the view meets
  the floor. `length` still caps them, so give it room: an edge that hasn't met the floor by then stops there.
- `far: false` leaves the end open, so the edges read as "and onwards". `fill` (0) is the opacity of a see-through
  fill across the end rectangle or footprint. `body: false` drops the glyph, for a camera the scene already shows.
- `size` (0.3) is the glyph's length and `thickness` (0.02) each bar's width; set both from an inset's
  `unitsPerPixel` to hold them at a pixel size. `camera`, `aspect`, `length`, `floor`, `size` and `thickness` are
  settable, and show on the next `update()`.
- `frustum.eye` and `frustum.corners` (top-left, top-right, bottom-right, bottom-left, as the camera sees them) are
  the eye and the end rectangle or footprint, in the parent's space, for labels and framing. Copy one into a label's
  `at` each frame, or pin the label to the helper itself (`node: frustum`) to follow the eye.
- Every bar lies just outside the volume and the glyph behind the eye, so a camera drawing its own picture never sees
  its frustum, as long as the aspects match. A pyramid's four edges meet in a point just behind the eye, so a thick
  one with `body: false` still ends in a clean tip. The fill lies inside the volume, so a camera whose passes draw
  see-through meshes sees it; it hides in an InsetView's pass.
- A ghost of an earlier view is `color: 'ink', opacity: 0.22`, with `ghost.camera = null` and
  `ghost.setPose(position, quaternion)` (both in the parent's space). It keeps the shape it last read from a camera,
  and follows `view`'s aspect and its own settings.
- The colour is `'ink'` by default; `color`, `opacity`, `muted`, `xray` and `pass` work as on every helper.

```ts
const frustum = new FrustumHelper({
  camera: securityCamera,
  floor: 0,
  length: 12,
  fill: 0.12,
  color: 'accent',
  parent: view3d.root,
});
const tag = labels.add({ text: 'footprint', offset: { x: 0, y: 20 } });

app.ticker.add(() => {
  frustum.update();
  tag.at.copyFrom(frustum.corners[3]);
  labels.update();
});

// In another view's scene, a ghost of where the main camera was: it reads the shape once, then holds the pose.
const ghost = new FrustumHelper({ camera: view3d.camera, view: view3d, opacity: 0.22, parent: overview.root });

ghost.camera = null;
ghost.setPose(saved.position, saved.quaternion);
```

It draws in one call (the edges, the end and the glyph are one `BarsGeometry`), two with a `fill`.

## LightHelper.ts

A light's shape, the part of a light a reader can't see. A `DirectionalLight` gets parallel arrows along its beam,
which say "one direction, everywhere". A `PointLight` gets its bulb, a camera-facing ring at its `range` and the ring
where that range meets the floor. A `SpotLight` gets a small lamp (a wide body behind the light and a short lip
flaring along the beam, so it never reads as an arrowhead), its axis, four edge lines out to `length` and two rings
there: the outer one at `coneAngle` and a thinner inner one at `coneAngle × (1 − penumbra)`, where full strength
ends. An `AmbientLight` has no position or direction, so it gets no helper.

- `new LightHelper({ light, parent: view3d.root })`. Put it under `view3d.root` or the light's parent, not under the
  light: hiding a light hides its children. Call `helper.update()` each frame. It reads the light's world pose
  (`getGlobalTransform`, so the light can live inside a model while the helper lives elsewhere), its `range`,
  `coneAngle`, `penumbra`, colour and `visible`, places itself at the light, and rewrites its lines in place only
  when a size changed. A light that only turns or slides costs a transform, with one exception: a point light's
  footprint rebuilds when its light moves up or down, since its radius depends on the light's height. Its range ring
  rebuilds only when `range` or `thickness` changes.
- Colour. With no `color`, the rays, cone and rings draw in the light's own colour, or `'ink'` while that's near
  white (every channel 0xe0 or more), so a white key light doesn't vanish into the light theme's haze. A colour
  picker bound to the light is followed in place on the helper's own material, so it never grows the kit's cache.
  Giving `color`, or setting it later, stops the following; `helper.followColor = true` resumes it. The bulb always
  takes the light's colour (or ink while it's near white): `color` sets the rings, for a highlight.
- `thickness` (0.02) is every line's width, in the parent's units. Like `spread`, `length`, `gap`, `target`, `range`
  and `footprint` it's a field you can set; the next `update()` rebuilds. On a narrow view, where `fitPortrait` backs
  the camera off, a 0.02 line drops under a pixel and the rays' heads vanish: raise it (0.045, say, when the screen
  is taller than it is wide).
- `DirectionalLight`: `rays` (3, fixed at construction), `spread` (0.6, the distance between neighbouring rays, across
  the light's local y, so a light above the scene shows them side by side), `length` (1, each ray's) and `target`
  (a point in the parent's space): the rays end `gap` (0.9) short of it. Without a target they end at the light's
  position plus its direction. The option is copied into `helper.target`, a `Vector3` you can write in place
  (`helper.target.set(…)`) or set to `null`.
- `SpotLight`: `length` (1) is the cone's length along its axis. To lay the rings on the floor under a lamp that
  points straight down, give its height (a hair less, so they don't fight the floor). The cone is drawn up to 85°;
  `penumbra: 0` draws one ring.
- `PointLight`: `bulb` (0.08) is the dot's radius, 0 to hide it; it's settable, for a bulb that swells with its
  light. `range: true` adds the camera-facing ring at the light's `range`, the outline of the sphere it reaches;
  `footprint: y` the flat ring where that sphere meets the plane at world height `y`, radius
  `√(range² − (lightY − y)²)`. Each ring hides when the range is 0 or the sphere doesn't reach. `brightness` (0 to 1,
  default 1) is the bulb's look, from muted ink at 30% to the light's colour; it writes the bulb's own material, so
  it can follow an animated intensity every frame.
- A hidden light (`light.visible = false`) keeps its helper, drawn muted with the bulb off, so a switched-off light
  still shows where it is. `muted` and `brightness` keep their values for when it comes back. `muted` is also the
  look for a light a mesh ignores. To remove the helper, hide it.
- `helper.tail` is the bulb, the spot's apex, or the centre of the rays' tails, in the parent's space: copy it into a
  label's `at` each frame. With an even `rays` count that centre falls in the gap between the middle two rays. A
  spot's lamp stands `7 × thickness` behind the apex, so a tag above a lamp that points down needs lifting clear of it
  (about `offset: { x: 0, y: -34 }` at the default thickness).
- In an inset's pass (`pass: inset.pass`) it draws solid in cached pass materials: a light colour change there builds
  a shader, so keep it steady; the range ring faces the camera and hides; the bulb is on or off.

```ts
const sun = new LightHelper({ light: stage.key, target: { x: 0, y: 1.5, z: 0 }, parent: view3d.root });
const lamp = new LightHelper({ light: spot, length: spot.position.y - 0.01, parent: view3d.root });
const bulb = new LightHelper({ light: point, range: true, footprint: 0, parent: view3d.root });
const tag = labels.add({ text: 'stage.key' });

app.ticker.add(() => {
  sun.update();
  lamp.update();
  bulb.brightness = point.intensity / PEAK; // the bulb dims with the light
  bulb.update();
  tag.at.copyFrom(sun.tail);
});
```

Its line work is written by the functions in `lightShapes.ts`, which an example never calls. Draw calls: 1 for a
directional or spot light (rays, lamp, edges and rings are one geometry), up to 3 for a point light: the footprint
ring, the range ring and the bulb. WebGPU keeps an empty draw for a ring that's off, so a point light is always 3
there.

## SkeletonHelper.ts

`new SkeletonHelper({ skeleton, space, parent })` draws a skinned model's current pose as a stick figure over its
skin: a bone from each joint to each joint below it, and a short stub past a joint with none below it (a foot, the
head, a tail tip). Each bone is an octahedron, widest just past the joint it leaves and pointed at the next, so the
wide end marks the joint and the point shows which way the chain runs. It's ink at 0.9 and `xray` by default, so the
bones show through the fur the way a 3D tool shows a rig.

- `skeleton` is the one to draw (`model.skeletons[0]`), `space` the container its skin is drawn in, usually the
  `Model3D`: the helper finds the `Mesh3D` under it that `skeleton` deforms, and throws if there's none.
- `helper.update()` each frame, after the player has posed the skeleton. It calls `skeleton.updateWorld()` first, so
  a bone bound with `bindContainerBone` already shows its container's value, then places every bone from the skinning
  matrices and the skin's `getGlobalTransform`. That's right before the first render and on the frame the model
  moves; the constructor calls it once too. It allocates nothing.
- Every index is a node index, the way `skeleton.indexOf(label)` returns it. A node `skeleton.joints` lists is a
  joint; any other node is only walked through. `root` (every node) draws only that node's subtree: a glTF file often
  has root joints at the model's origin, and without `root` their bone runs up from the floor to the hip.
- `thickness` (0.05) is each bone's width at its widest and `leafLength` (0.2) a stub's length. Both are in the
  helper's units, its parent's space (world units under `view3d.root`), not the model's: Fox.glb is about 79 units
  tall, so scale the model rather than the numbers. A bone's length is the gap between its joints, so long bones read
  thin and short ones stubby. Both are settable, and the bones change at once: widen them on a phone once
  `fitPortrait` has backed the camera off (`rig.thickness = 0.1`).
- `leafAxis` (+y) is the way a stub points, in its joint's own space. Blender exports bones along +y; some rigs, the
  Khronos fox among them, along +x. `leafLength: 0` hides the stubs, and a later `leafLength` shows them again.
- `helper.highlight(node, color)` draws the bones leaving joint `node`, or its stub, in that colour and 1.6 times as
  wide; `null` restores them. Those are the bones the joint's rotation turns, so `highlight(head, 'accent')` lights
  the head's stub down the snout and `highlight(tailBone, BRAND.purple)` the bone from the tail joint to the next.
  It shows at once, paused or not; under `muted` a lit bone draws in the quiet ink at its usual width. A lit joint
  keeps a material of the helper's own, so `opacity` can fade and a highlight's colour can follow a picker without
  making new ones. At opacity 1 a highlight draws with the kit's shared material for its colour instead, until the
  helper has materials of its own (once its `opacity`, or a hex `color`, moves off what it was built with), so keep to
  a few colours there rather than following a picker.
- `helper.getJointPosition(node, out)` is where a joint was at the last `update()`, in the helper's parent's space,
  for labels and arrows: `helper.getJointPosition(head, tag.at)`.
- `highlight` throws for a node that isn't a joint or isn't in `root`'s subtree; `getJointPosition` throws for a
  node that isn't a joint.
- `color`, `opacity`, `muted`, `xray` and `pass` work as on every helper. In a pass it draws solid, and a part under
  opacity 1 hides there, so give an inset's skeleton `opacity: 1`.

```ts
// Fox.glb is modelled about 79 units tall; this stands it 1.4 tall, the size the bone widths are picked for.
const fox = new Model3D({ source, autoUpdate: false, autoPlay: 'Survey', scale: 1.4 / 79, parent: view3d.root });
const skeleton = fox.skeletons[0];
const head = skeleton.indexOf('b_Head_05');
const rig = new SkeletonHelper({
  skeleton,
  space: fox,
  root: skeleton.indexOf('b_Hip_01'),
  leafAxis: { x: 1, y: 0, z: 0 },
  parent: view3d.root,
});
const tag = labels.add({ text: 'head', color: 'accent' });

rig.highlight(head, 'accent');
app.ticker.add((ticker) => {
  fox.player?.update(ticker);
  rig.update();
  rig.getJointPosition(head, tag.at);
  labels.update();
});
```

Every bone of every SkeletonHelper is one mesh on one shared geometry, and an x-ray helper draws in the transparent
pass, sorted back to front. WebGL breaks its draws only where the pipeline or geometry changes, so there every rig in a
view with the same `xray` setting, ink, accent and highlights alike, draws in one call. WebGPU also draws once per
change of material along that order, and merges the run into one draw only past 16: rigs in one colour and opacity
are one draw there too, and so were three fox rigs, 81 bones in ink, accent and purple at two opacities, but one fox
with three highlights is 6. Rigs with `xray` on and off whose bones overlap in depth split that pass at each switch
(three foxes measured 31 draws on WebGL and 31 to 43 on WebGPU), so give every rig in a view the same `xray`. Where the bones run is worked out once, from
the rest pose, by the functions in `skeletonBones.ts`, which an example never calls.

## overlay.ts

What every 2D overlay shares, so a tag, an inset and a mark look like one set. Each overlay takes a `stage`, a
`ThemeSource` (`{ readonly darkness: number }`, 0 light to 1 dark): a `ThemeStage`, or `{ darkness: 0 }` in an example
without one. It reads `stage.darkness` in its `update()` and repaints only when it changes.

- `overlayColor(role, darkness)`: `'panel'` is a panel's and a neutral tag's fill (white to night, shown at
  `PANEL_ALPHA`, 0.88), `'ink'` the theme's text colour, `'inkSoft'` its secondary one for titles and notes. Mid-fade
  the panel is grey, so the two text colours don't mix: each takes whichever theme's colour reads better on the panel,
  and text stays legible through a theme switch.
- `helperColorAt(color, darkness)`: a `HelperColor` as a 2D overlay draws it, with the theme read from the overlay's
  `stage`: `'ink'` is the theme's `inkSoft`, as on the 3D helpers, taking a side mid-fade as the text does, and
  `'haze'` the background colour, mixed along with it.
- `textOn(fill)`: night or white, whichever has the higher contrast ratio on a solid fill. Every axis colour, the
  accent and the brand and clay colours get night text.
- The label font: `LABEL_FONT` (13 px monospace, `LABEL_FONT_SIZE`), installed by `useLabelFont()` on first use and
  uninstalled by the last `releaseLabelFont()`. Every overlay pairs the two; nothing else installs the font. It
  draws printable ASCII and `° · × − → ← ↑ ↓ ≈ π θ … ≥ ≤` up front, and adds any other character the first time a
  text uses it.
- `type Corner = 'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right'`, and `NARROW_BELOW`
  (600): under that width panels dock the narrow way and the pane opens collapsed.
- `viewRect(view3d, out, camera = view3d.camera)`: the rect in global px that the camera's viewport fills on the view,
  following its position, anchor and size: the whole view, or half of it in a split screen. Outline a view with it,
  or keep tags inside it.

## LabelLayer.ts and Label.ts

Small tags pinned to points in the scene or on screen, naming a node, an axis or a point where it is. A label is
2D pixi text in a rounded tag, placed each frame where its point lands on screen, so it stays sharp and the same size
at any distance.

- `const labels = new LabelLayer({ view3d, stage })`; add it after the view (`app.stage.addChild(view3d, labels)`)
  and call `labels.update()` at the end of each tick, once the scene has moved. It works as a child of a moved
  container too.
- Every tag stays `margin` px (16) inside `bounds`, sliding in along the edge rather than leaving it. `bounds` is
  read live and defaults to `viewRect(view3d)`; pass `app.screen` when `fitPortrait` grows the view past the screen.
  `project(world, out)` is how a world point reaches the screen (`view3d.worldToScreen` by default); an inset passes
  its own camera's.
- `labels.add({ text, node, at, color, offset })` follows `at` in `node`'s space (the root and its origin by
  default), 18 px above the point. `screen: { x, y }` pins it to a point in global px instead: `label.screen` is the
  label's own `Point`, which you move (`label.screen.copyFrom(event.global)`), and `offset` defaults to 0 there.
  `at` is copied too: move it with `label.at.set(…)`.
- `anchor` (`{ x: 0.5, y: 0.5 }`) is the part of the tag that sits on the point plus `offset`: `{ x: 0, y: 0.5 }`
  hangs its left end there, `{ x: 1, y: 0.5 }` its right end. `label.offset` and `label.anchor` are `Point`s you can
  write later.
- `color` (settable): `null` is the neutral tag that follows the theme; a `HelperColor` makes a solid tag with
  `textOn` text, for axis names and lights. `label.color = 'accent'`, then `null` a beat later, lights a change.
- `leader: true` draws a dot at the point and a thin line to the tag's nearest side, in `inkSoft` or the tag's colour,
  for a tag that floats away from what it names. The line stretches as the margin slides the tag.
- `swatch: 0xRRGGBB` (settable, `null` removes it) puts a 10 px colour chip before the text, ringed in the tag's ink.
- A `\n` in the text stacks lines, centred.
- A label hides while its point is behind the camera or outside `bounds`, while its node or any ancestor is hidden,
  while `label.hidden` is set, and while its text is empty. `alpha` is pixi's own: a muted label is
  `label.alpha = 0.4`. `labels.remove(label)` removes and destroys one.
- A label names what the person couldn't otherwise pick out, in a word or two: `origin`, `+z`, `near`. It never
  prints code or a live value, `rotation.y = 0.44` included: name the thing, and let the pane show its value, as a
  bound row or a read-only one.

```ts
const labels = new LabelLayer({ view3d, stage });

labels.add({ text: 'x', node: axes, at: axes.tips.x, color: 'x' });
labels.add({ text: 'origin', node: letter, offset: { x: 70, y: -60 }, leader: true });

app.stage.addChild(view3d, labels);
app.ticker.add(() => labels.update());
```

## ScreenLines.ts

Lines, rects, ellipses, arrows and dots in screen pixels, for every 2D mark that isn't text: a view's outline, a dashed
frame, a 2D arrow, a ring round a projected point. Coordinates are the container's own: global px when it sits on
`app.stage` at the origin, or a panel's own px when it's the panel's child.

- `new ScreenLines({ stage, color = 'ink', width = 1.5, alpha = 1, dash = 0, gap = dash })`: the style it starts in
  and returns to on `clear()`. Colours are a `HelperColor`.
- `clear()` hides every piece; call it before a redraw. `style(color, width = 1.5, alpha = 1, dash = 0, gap = dash)`
  sets the style for the shapes after it; dashes run along each shape's whole length.
- `line(x0, y0, x1, y1)`, `polyline(xy, count = xy.length / 2, closed = false)` (x, y pairs; a NaN lifts the pen),
  `rect(x, y, width, height, radius = 0)`, `fillRect(x, y, width, height)`, `ellipse(cx, cy, rx, ry, segments = 48)`,
  `arrow(x0, y0, x1, y1, head = 8)` (the head's tip lands on the end; it shrinks on a short arrow and drops under
  3 px) and `dot(x, y, radius, hollow = false)` (a ring of the line width when hollow). Each returns the ScreenLines,
  so a redraw chains.
- `update()` each frame re-tints the pieces drawn in `'ink'` or `'haze'` when the theme changes.
- Redraw only when something moved, or every frame for a moving mark: a redraw moves pooled sprites and allocates
  nothing once the pool has grown. A `'haze'` dot under a smaller one is a rim that parts a mark from what's behind it.

```ts
const marks = new ScreenLines({ stage });
const frame = new Rectangle();
const at = new Point();

app.stage.addChild(view3d, marks, labels);
app.ticker.add(() => {
  viewRect(view3d, frame);
  marks
    .clear()
    .style('ink', 1.5, 0.5, 6, 5)
    .rect(frame.x + 10, frame.y + 10, frame.width - 20, frame.height - 20, 12);
  if (view3d.worldToScreen(logo.root.position, at)) marks.style('accent', 2).dot(at.x, at.y, 40, true);
  marks.update();
});
```

## Panel.ts

`Panel` is the rounded card every 2D panel is. `InsetView` extends it, and the cards that are part of an example's
subject build on it: a pixi menu the 3D view sits in, a magnifier, a shelf of thumbnails. It's never an explainer panel of text or a
diagram. It paints in the neutral tag's colours, edged by a 1 px rim of soft ink at 12% so a card still reads as one on
white checks or a dark sky, and ignores the pointer, so a drag over it still orbits.

- `new Panel({ stage, screen: app.screen, corner, title, note })`. With `corner` it docks itself 24 px from the screen's
  edges (`margin`); without one you place it with `position`. `stackOn`, given another panel, sits it 8 px from that
  panel in the same corner, above it in a bottom corner and below it in a top one, taking the other panel's screen and
  corner when it has none, down a chain of stacked panels. A hidden panel leaves its place in the stack to the one under
  it, or to the screen's edge.
- Under 600 px wide it docks the narrow way: a `top-*` panel sits at y 52, under the collapsed pane, a `bottom-*` one
  centres at the bottom, and the gutters drop to 16 px. `narrow: { corner, width, height }` overrides that layout;
  `width: 'full'` spans the screen less the gutters.
- `screen` can be any rect, read again at each update: give two panels each half of a phone's width, or a column down
  one side, write the rects on a resize, and each docks, narrows and fills its part. The stack and the corner can't
  change after construction, so an arrangement that changes them builds the panels again.
- `title` and `note` (settable) are a soft title row along the top, the note at its right end. `lightTitle()` lights
  the title in accent over a soft accent wash for `hold` seconds (1.5), then fades it back over 0.4 s.
- `radius` (10), `padding` (12), and `raised: true` for ink at 8% instead of the panel colour: a card inside a panel.
- `panel.setSize(width, height)` sizes it, padding included; the card redraws only when the size changes.
  `panel.update(dt)` each frame repaints on a theme change, docks, and runs the light. Update a stacked panel after
  the one it stacks on.
- `panel.rect` is its rect in global px after the last update, for stacking, fitting and keeping tags off it.
  `panel.narrow` says the screen is under 600 px wide, and `panel.availableWidth` is the width it may take there.
  `panel.contentTop` is where content starts, under the title row.
- A subclass draws its content over the card from `contentTop` down, repaints it in `paint(darkness)` (calling
  `super.paint`), and calls `super.update(dt)` from its own `update`. Panel's own private names (`_dockAndMeasure`,
  `_paintedDarkness` and the rest) are taken, so a subclass names its privates differently.

```ts
const card = new Panel({ stage, screen: app.screen, corner: 'bottom-right', title: 'Panel', note: 'live' });
const tile = new Panel({ stage, raised: true, title: 'raised', padding: 8 });

card.setSize(300, 132);
tile.setSize(116, 82).position.set(card.padding, card.contentTop);
card.addChild(tile);
app.stage.addChild(view3d, labels, card);
app.ticker.add((ticker) => {
  card.update(ticker.deltaMS / 1000);
  tile.update(ticker.deltaMS / 1000);
});
```

## InsetView.ts

A second picture in a rounded corner panel, with a small title tag on its edge and an optional caption under it: the
same scene from another camera, a small scene of its own, or a texture something else renders. It's the kit's side
view, minimap, magnifier and texture card. It's a `Panel`, so it docks in a corner, stacks with `stackOn` and takes the
narrow layout on a phone; add it to `app.stage` after the view and call `inset.update(dt)` each frame, once the scene
and its camera have moved. Its parts have files of their own: `InsetPicture.ts` (the picture in each mode),
`InsetPasses.ts` and `InsetSkyPass.ts` (the same-scene camera and passes), `InsetTitle.ts` (the tag and its light) and
`insetCamera.ts` (projecting and framing).

The options pick the mode:

- **Same scene** (`view3d` given): `inset.camera` is a new `Camera3D` (fov 40) under `view3d.root` that draws into a
  render texture the picture's size. The inset appends four passes to `view3d.passes`: the view's background from that
  camera, the opaque meshes, the inset-only helpers (the MeshPass named `pass`, `'inset'` by default), then the
  transparent meshes sorted back to front. Place the camera yourself, or with `frame()`. A second inset on the same
  view needs its own `pass` name.
- **Own scene** (neither `view3d` nor `texture`): `inset.view3d` is a small `View3D` on the picture, with `inset.root`
  and `inset.camera` its own. It has no lights or environment and `toneMapping: 'none'`; set them on `inset.view3d`.
  Its background is the panel colour and follows the theme until you set `inset.view3d.background` (or a ThemeStage
  does).
- **Texture** (`texture` given): a sprite of that very texture, aspect kept inside the picture and centred, so a live
  `RenderTexture` resized in place refits on the next update. `camera`, `view3d` and `root` are `null`.

Options, on top of `Panel`'s (`stage`, `corner`, `stackOn`, `margin`, `narrow`, `radius`, `hold`):

- `app` (needed): `screen` defaults to `app.screen`, and `resolution` to the renderer's.
- `width` (320) and `height` (180): the **picture's** size in px, and so are `narrow.width` (`'full'` spans the screen
  less its gutters) and `narrow.height`. The panel grows round it by `padding` and the caption's row.
- `padding` (4): the rim between the panel's edge and the picture, in place of Panel's 12.
- `title`: a small neutral tag on the panel's edge at `titleCorner` (`'top-left'`; any `Corner`), in place of Panel's
  title row. It overlaps the panel by the rim only and stands about 15 px out past the edge, so it never covers the
  picture. That's more than the 8 px between stacked panels, so on a stacked panel put the tag on the side away from
  the stack. Empty hides it.
- `caption`: one line of soft text in a row under the picture; empty drops the row, and the panel shrinks round it at
  once.
- `mode` (`'perspective'` or `'orthographic'`): the inset camera's projection.
- `pass` (`'inset'`) and `resolution` (the render texture's pixels per px): same scene only.
- `eventMode` (`'static'`): a press on the panel stops there, so it doesn't orbit the main view. Pass `'none'` to let
  drags over it reach the view.

Methods and properties:

- `inset.only(node)` sets `pass = inset.pass` on every kit helper under `node`, so it draws in the inset and nowhere
  else; or build a helper with `pass: inset.pass`. It covers helpers there at the call: give later ones the pass
  yourself. A plain `Mesh3D` can't be inset-only. In a pass a helper draws solid, so see-through and camera-facing parts
  (a wedge, a fill, a dot's outline) hide, and its ink flips with the theme halfway through a fade. Same scene only; it
  throws on the others.
- `inset.labels`: a `LabelLayer` whose tags pin through the inset's camera and stay 8 px inside the picture. `update()`
  updates it. A texture inset has no camera, so reading it throws: put tags on a texture card in your own LabelLayer,
  added after the inset.
- `inset.overlay`: a container over the picture and clipped to it, under the labels, in global px, for `ScreenLines`
  marks: a ring round a projected point, a feed's outline, a crossed-out texture.
- `inset.project(point, out)`: a world point through the inset's camera into global px, for the overlay; `null` behind
  a perspective camera (an orthographic one projects points behind it too) or with no camera. It reads the camera's
  pose as it is now, so marks on a camera you moved this tick don't trail a frame.
- `inset.frame(points, margin = 16)`: moves the camera along the way it faces so `points` fill the picture less
  `margin` px (a number, or `{ top, right, bottom, left }`), by distance for a perspective camera and by
  `orthographicSize` for an orthographic one, and sets `near` and `far` round the points with room to spare. It
  allocates nothing, so a camera that moves can refit every frame. `inset.unitsPerPixel` is then the world size of a
  screen px at the points' depth, for helpers a set number of px thick. The picture has its size from construction,
  the narrow size on a phone included, so `frame()`, `project()` and `unitsPerPixel` are right before the first update.
- `inset.light()` lights a 2 px accent outline and the title for `hold` seconds, then fades them over 0.4 s;
  `inset.focus(on = true)` holds that look until `focus(false)`, for a card that stays lit while its layer shows.
  Panel's `lightTitle()` is `light()` here, and its `note` reads empty, since an inset has no title row.
- `inset.picture` (the picture's rect) and `inset.rect` (the whole panel) are in global px, placed at each update.
  `title`, `caption` and, in texture mode, `texture` are settable; `setSize(width, height)` resizes the picture.
- `camera`, `view3d` and `root` are typed `| null`, since a texture card has none: keep the reference once
  (`const sideCamera = inset.camera!`, with a comment saying a same-scene inset always has one).

```ts
const inset = new InsetView({ app, view3d, stage, title: 'side view', corner: 'bottom-right' });
const frustum = new FrustumHelper({ camera: view3d.camera, view: view3d, length: 6, parent: view3d.root });
const eyeTag = inset.labels.add({ text: 'main camera' });
const ring = inset.overlay.addChild(new ScreenLines({ stage, color: 'accent' }));
// The positions themselves, so the list follows them with no new array each frame.
const framed = [view3d.camera.position, subject.position];
const at = new Point();

inset.only(frustum); // the main camera's view volume, drawn in the side view only
inset.camera!.position.set(-12, 5, 2); // a same-scene inset always has a camera
inset.camera!.lookAt({ x: 0, y: 1, z: 2 });
app.stage.addChild(view3d, inset);

app.ticker.add((ticker) => {
  inset.frame(framed, 24); // refit as the main camera moves
  frustum.thickness = inset.unitsPerPixel * 1.5; // 1.5 px wide in the inset
  frustum.update();
  eyeTag.at.copyFrom(frustum.eye);
  ring.clear();
  if (inset.project(subject.position, at)) ring.dot(at.x, at.y, 30, true);
  inset.update(ticker.deltaMS / 1000);
});
```

A texture card is the same class with `texture`:

```ts
const card = new InsetView({
  app,
  stage,
  texture: mirrorCamera.renderTexture,
  title: 'mirror',
  width: 240,
  height: 135,
  caption: '640 × 360',
  corner: 'bottom-right',
});

card.focus(true);
```

## LoadingScreen.ts

The wordmark over a thin pink bar, painted in the stage's colours so it dissolves straight onto the first frame. It's
DOM, so it shows before the renderer exists.

- `progress(value)` sets the bar, 0 to 1; it only grows. Until the first call a sheen runs along it.
- `load(task, until = 0.9)` runs `task` and fills the bar from where it is to `until` as the bytes arrive (it counts
  what pixi's loaders download through `fetch`; image textures load in a worker by default, so they don't count). Run one at a time; put parallel loads in one task with
  `Promise.all`. A failed task leaves the screen up with a note.
- `finish()` fills the bar, holds a beat, fades out and removes itself. `fail(message)` and `destroy()` too.

## Draw calls

Draw what the lesson is about, not every node: each 3D helper is a draw or a few, and a phone holds 60 fps on a
handful. What each costs, as `RenderGraphDebugger` counts it, on both renderers unless the row says otherwise. WebGPU
keeps an empty draw for a hidden part, such as a fill at 0 or a light's ring that's off, and draws parts that share a
geometry once per colour until they pass 16; WebGL skips the first and draws the second in one call.

| Visual                                                               | Draws                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ArrowHelper`, `AxesHelper`                                          | 2, and 7 (3 on WebGL)                                                               |
| `AngleHelper`                                                        | 3; one less without the wedge, one less without a head                              |
| `BoxHelper`, `DotHelper`                                             | 1 each; 2 with a fill or a rim (WebGPU counts a box's fill even at 0)               |
| `GhostHelper`                                                        | 1 per mesh it copies                                                                |
| `PathHelper`, `RingHelper`, `DimensionHelper`                        | 1 each, however many curves, dashes or ticks                                        |
| `GridHelper`                                                         | 2 with its outline, 1 without                                                       |
| `WireframeHelper`, `NormalsHelper`, `TriangleHelper`, `PointsHelper` | 1 each                                                                              |
| `SphereHelper`                                                       | 1 with a `camera`, 2 without; one more for a fill, which WebGPU counts even at 0    |
| `FrustumHelper`                                                      | 1; 2 with a fill                                                                    |
| `LightHelper`                                                        | 1 for a directional or spot light, up to 3 for a point (always 3 on WebGPU)         |
| `SkeletonHelper`                                                     | 1 for every rig in the view on the same `xray`; on WebGPU up to 16 once colours mix |
| Labels, `ScreenLines`, `Panel`                                       | usually none of their own                                                           |
| `InsetView`                                                          | about 3 for its rounded clip, plus its picture                                      |

Changing a helper's colour, opacity, `muted` or `xray` swaps a cached material or writes the helper's own in place,
and adds none to a helper on its own; on WebGPU, a new colour on one of several helpers that share a geometry adds
one. The 2D overlays are sprites, Graphics, meshes and `BitmapText`, which pixi batches with each other: the tags,
marks and cards usually draw together in one call after the view. An inset's clip is a stencil mask, about three draws (writing it, the picture and overlay inside it, clearing it). A same-scene inset
adds a sky draw and the scene's opaque and transparent draws again from its camera, at the picture's size; measured on
WebGL over a 3-cube view, a same-scene inset adds 7 draws and each inset-only helper part 1 more, an own-scene inset
holding one cube adds 5, and a texture card 4.

## Releasing

The kit owns what it caches: call `releaseClayGeometries()`, `releaseClayMaterials()`, `releaseHelpers()` and
`releaseParticleTextures()` in your teardown, after `view3d.unload()`. `releaseHelpers()` frees the helpers' cached
materials (pass ones included), the shared shaft, head, dot and bar geometry, and every `sharedHelperResource`, among
them the bone geometry SkeletonHelper draws with and the rim an outlined dot wears. `releaseClayMaterials()` destroys
the shared clay and stops your own from following the theme; they stay yours to destroy. After `stage.destroy()`,
`releaseReflections()` unloads the cube map `loadReflections()` loaded.

Everything else is yours to destroy:

- `stage.destroy()`, `logo.destroy()` (which unloads the model once no other logo uses it), `monitor.destroy()` (its
  nodes and geometry; the screen's material stays yours), `pane.dispose()`, `fit.stop()` on what `fitPortrait`
  returns, and the clay materials `createClayMaterial` made (destroying one stops it following the theme).
- Every helper you created. `destroy()` frees its meshes, the geometry it built (an angle's arc and wedge; a box's,
  path's, span's, grid's, wireframe's, normals', sphere's, frustum's and light's bars; a ring's tube; a triangle's
  face) and
  its own materials (a light's followed colour, a rig's highlights, a `PointsHelper`'s particle container and
  material). A path, span, grid or wireframe that grew freed the bars it outgrew at the time. A `HelperMaterial` you
  made is yours to destroy too. A helper still set to an inset's pass draws nowhere once the inset is gone.
- The overlays: `labels.destroy()` (or `labels.remove(label)` for one), `marks.destroy()` for a `ScreenLines` and
  `panel.destroy()` for a `Panel`. Each frees its text, sprites and Graphics, their contexts included, and does nothing
  when called again. The label font goes with the last overlay that uses it, and the ScreenLines' shared mark textures
  with the last ScreenLines.
- `inset.destroy()` takes its passes out of `view3d.passes` and frees its camera, render texture, own view (with
  everything under `inset.root`, though geometry and materials stay yours), label layer and whatever is in `overlay`,
  and the panel. A texture given to an inset stays yours.
- `badge.destroy({ context: true })` for a wordmark badge.
