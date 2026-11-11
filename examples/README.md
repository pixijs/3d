# Examples

Each example teaches one feature of `@pixi/3d`, or a few that belong together, to a person and an AI agent learning
the engine together. The agent reads the code and explains it; the person looks at the picture, orbits it and works
the pane. So the code carries the explanation, and the picture shows only the core of the idea: the subject, what the
feature does to it, and the few visuals that draw what can't otherwise be seen. `to-make.md` lists the examples to
build.

Run them with `npm start`; the playground lists every `examples/<id>/index.ts`.

## Files

Every example is a folder, `examples/<category>_<name>/`. The playground groups examples by the part before `_`, so
`examples/materials_clearcoat/` shows as **clearcoat** under **materials**. The categories and names come from
`to-make.md`. `examples/tutorials/` isn't an example: it holds the step-by-step tutorials pixijs.com publishes, which
`tutorials/README.md` describes, and the playground doesn't list them.

The files split by role, so the lesson stays easy to read while the visuals that explain it grow:

- **`index.ts`, the lesson.** The boot, then the feature in the order a reader should meet it, then the frame loop.
  Every call to the API being taught is here, so a reader who opens only this file sees the whole lesson.
- **`visuals.ts`, what explains it.** The helpers, labels and inset views drawn to show the concept. It
  reads the scene each frame and never changes it, so the lesson runs the same without it. It exports
  `createVisuals(options)`, which takes the objects and values it shows and returns `{ update }`; `index.ts` calls
  `visuals.update()` at the end of each tick, once the scene has moved.
- **`scene.ts`, the props.** What the lesson needs on stage but doesn't teach: a turret built from clay, a row of
  shapes, a model's placement. It exports builder functions named for what they build (`createClay`).
- **`controls.ts`, the pane**, once it passes about six rows or needs handlers. A short pane that binds the feature's
  own properties stays in `index.ts`, where the reader sees what each row changes.
- **Anything the example teaches** gets a file of its own: a custom material class, a shader, an emitter.
- **`README.md`, what it is, and `reference.png`, what it draws.** Every example has both; see "The README and the
  reference image" below.

Create only the files the example needs; a small example can be `index.ts` alone, with its README and reference image.
Use these names, so a reader opening
any example knows where to look. Each file starts with a header comment saying what it holds. `index.ts` aims for 150
lines, and no file passes 250.

## Imports

- Only the public API: `@pixi/3d`, `@pixi/3d/extras` and `pixi.js`, plus the theme kit by relative path
  (`../shared/theme/…`) and `rendererPreference` from `playground/src/getPreference.ts`. Never `~/`, `src/` or a
  file under `src/`; `npm run test:unused` catches an internal one.
- Assets come from `/test-assets/…` (the files in `examples/assets/`) or the accessors in `examples/assets/manifest.ts`,
  such as `model('gltf.<Name>')` or `model('pixijs.Logo')`. Use a downloaded model only when the feature needs one
  (skinning, a glTF extension).

## The picture shows the core

The frame shows the feature at work and little else. Before writing code, list each concept the example names and
decide what in the frame shows it, then build only that. How it works goes in the code and its comments, where the
agent reads it.

- **No code or diagrams on screen.** No code cards, charts, scene trees, explainer panels or other 2D diagrams. The
  agent reads the code to the person, so the picture doesn't repeat it.
- **Draw the invisible, when it's the core.** A space, an axis, a pivot, a direction, a bound, a frustum or a light's
  range doesn't show on its own. When the lesson is about one, draw it with the kit's 3D helpers
  (`examples/shared/theme/README.md` lists them): `AxesHelper` for a node's own space, `ArrowHelper` for a direction
  or an offset, `AngleHelper` for a turn, `BoxHelper` for a box, `GhostHelper` for the pose before a change. Draw
  nothing the core concept doesn't need.
- **Label little.** A `LabelLayer` label names what the person couldn't otherwise pick out (`origin`, `+z`, `near`).
  Values live in the pane: a bound row shows its own value, and a read-only row (`readonly: true`) shows a derived one
  such as draw calls.
- **The reader drives.** The scene opens in the state that shows the feature best and stays in it until the reader
  changes it. Nothing plays the lesson for them: no tours, no timed switches between states, no sweeps of a value, no
  demo pointer that clicks or drags, no camera that moves itself. Every state the lesson compares is a pane row.
  When watching the change is the lesson (a clipping plane sweeping through the scene, a mesh trading its LOD as it
  moves away, a node turning to follow its target), the scene animates it on its own, and a pane row pauses it.
  Moving a row the animation drives pauses it too, so the value stays where the reader put it.
- **The pane and the picture move together.** A value the pane changes shows in the picture in the same frame.
- **Show the contrast.** When the lesson is a difference (degrees and radians, local and world space, with and without
  an effect), put both in view: side by side, as a split view, in an inset view, or one as a ghost of the other.

## The look

The examples share the theme kit's look, so a reader who opens three in a row sees one collection. The kit is the
default, not a cage: depart from it whenever another setup teaches the idea better.

- **Start from the kit.** `ThemeStage` (the light and dark checker floor, fog, lights and `toneMapping: 'none'`), the
  palette, the clay shapes, the floating PixiJS logo, the pane and the loading screen. Every example works on both
  themes and opens on the light one, unless the dark one shows the feature better (bloom, a thin line of light).
- **Depart when it teaches better.** A top-down or orthographic camera, a split screen or an inset second view, a
  grid or a plain backdrop instead of the floor, a different light setup, many objects instead of one. Keep the
  palette, the kit's visuals and labels, the pane and the loading screen, so the example still belongs to the set.
  Change the stage's lights, fog or tone mapping when the example teaches them or the change makes the lesson clearer.
- **Subjects.** The logo (`loadPixiLogo`) for materials, lighting, shadows and post effects by default; clay shapes
  (`clayGeometry`, `clayMaterial`) for the scene graph, instancing, interaction and anything with many objects; the
  engine's own geometry when the geometry is the lesson; a model when the feature needs one. Pick the subject that
  shows the feature best.
- **Reflections.** A material that mirrors its surroundings (metal, clearcoat, sheen, iridescence) stands on the
  stage's `reflections`, loaded with `loadReflections()`, so every reflective example shows the same world.
- **Colour.** Scene colours come from the palette (`BRAND`, `CLAY`, `THEMES` in `palette.ts`) and helper colours from
  `helpers.ts` (x red, y green, z blue, `'ink'`, `'accent'`, `'haze'`). A feature that needs its own colours (vertex
  colours, light colours, particles) picks them from the palette.
- **Framing.** The subject sits centred and clear of the pane in the top-right corner. Extra UI (an inset view, a
  card, a readout) goes on the right side of the screen or along the bottom, never on the left. Camera `fov` 40
  unless the lesson is the camera. At 390 × 844 portrait the subject still fits across the width: `fitPortrait` backs the
  camera and the fog off on a narrow view.
- **Motion.** Gentle idle motion (a slow turn, a drifting light) keeps the scene live, as long as it never changes a
  value the pane controls or switches a state. Motion that is the feature (an animation clip, particles, a video)
  runs as the feature does. Motion comes from elapsed time, not random numbers, so two runs look the same.
- **Craft.** The scene looks designed: one clear focal point, shapes that read as what they are (a turret reads as a
  turret), nothing crossing, clipping or hiding behind something else, visuals and labels clear of each other and the
  subject, labels legible on both themes.
- **Restraint.** Everything on screen is the subject, what the feature does to it, or a visual the core concept
  needs. No decoration, no extra lights or effects the lesson doesn't need.

## The shape of an example

`examples/theme-kit.example.ts` uses the stage, clay, logo, pane and loading screen, and
`examples/shared/theme/README.md` documents every kit piece. `index.ts` follows this order, so a reader always knows
where to look:

```ts
/**
 * <What this example teaches, in one sentence>
 *
 * <Two or three sentences: the API it shows, and the idea a reader should leave with.>
 *
 * Controls: drag to orbit; <what the pane changes>. URL flags: `?theme=light|dark`, `?renderer=webgl|webgpu`.
 */

import { View3D } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

import { rendererPreference } from '../../playground/src/getPreference';
import { fitPortrait } from '../shared/theme/fitPortrait';
import { LoadingScreen } from '../shared/theme/LoadingScreen';
import { THEMES, themeFromUrl } from '../shared/theme/palette';
import { ThemePane } from '../shared/theme/ThemePane';
import { ThemeStage } from '../shared/theme/ThemeStage';
import { createVisuals } from './visuals';

/** The narrowest view, width over height, that shows the subject whole from the landscape distance */
const FIT_ASPECT = 1.35;

const theme = themeFromUrl();
// Up before the renderer, so the page is never blank.
const loading = new LoadingScreen({ theme, label: '<Title>' });
const app = new Application();

await app.init({
  preference: rendererPreference,
  resizeTo: window,
  background: THEMES[theme].haze,
  antialias: true,
  autoStart: false,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
loading.progress(0.2);

const view3d = new View3D({ autoResize: true });
const stage = new ThemeStage(view3d, { theme });

app.stage.addChild(view3d);

// The feature: build the scene here, in the order a reader should meet it.

const visuals = createVisuals({ app, view3d, stage /* , the objects it shows */ });

view3d.camera.fov = 40;
view3d.camera.position.set(0, 3.2, 10);

const orbit = new OrbitCamera({ view: view3d, target: { x: 0, y: 1.2, z: 0 }, enableDamping: true });

// A portrait screen is narrower than <the subject>, so the camera and the fog back off until it fits.
fitPortrait({ renderer: app.renderer, orbit, stage, minAspect: FIT_ASPECT });

const pane = new ThemePane({ title: '<Title>', stage });

// pane.addBinding(…) for each control, or createControls({ pane, … }) from controls.ts.

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 15);

  stage.update(dt);
  // The feature's per-frame code.
  visuals.update();
});

// The canvas joins with its first frame already drawn, then the loading screen dissolves onto it.
orbit.update();
visuals.update();
app.render();
document.body.appendChild(app.canvas);
await loading.finish();
app.start();
```

`visuals.ts` creates its own `LabelLayer` when it labels anything, adds it to `app.stage` after the view, and calls
`labels.update()` last in its `update`:

```ts
/**
 * What the frame draws to explain <the concept>: <the visuals, in a phrase>
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { Container3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { AxesHelper } from '../shared/theme/AxesHelper';
import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** <what it is in the scene> */
  subject: Container3D;
}

export function createVisuals({ app, view3d, stage, subject }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  // As the subject's child, the axes turn and stretch with it.
  new AxesHelper({ length: 1.2, parent: subject });
  labels.add({ text: 'local axes', node: subject, at: { x: 0, y: 1.4, z: 0 } });

  app.stage.addChild(labels);

  return {
    update() {
      labels.update();
    },
  };
}
```

- Top-level `await` in `index.ts`, no wrapping `main()`, no classes unless the example teaches one.
- Load assets with `loading.load(() => …)` so the bar follows the bytes.
- No teardown code: the playground drops the page when you leave an example. An example about lifetime
  (`destroy()`, `unload()`) is the exception, and its teardown is the lesson.

## The pane

`ThemePane` is a Tweakpane pane in the theme's colours whose first row switches the theme. Every example has one.

- Its title matches the loading screen label: the example's name in words, e.g. 'Clearcoat'.
- Bind the feature's own properties with the pane's addBinding. Label a binding with the property's name when it sets
  one directly (`roughness`), so a reader can find it in the code; use plain words for anything else ('Spin').
- Ranges are the ones that teach: the real limits of the property, or the span where it does something visible.
  Colours use `{ view: 'color' }` on a number.
- Group rows with addFolder once there are more than five. Use addButton for one-off actions, and a read-only
  binding (`readonly: true`) for live numbers such as draw calls.
- Wire bindings straight to engine objects where you can. Where a change needs code (rebuilding geometry, swapping a
  material), put it in one named function the `change` handler calls.

## Code

The examples are the code users copy, so they're held to the engine's standard (`CODING_STANDARDS.md`) and then
some. Clean code is half the lesson.

- **Clear before clever.** Name things after what they are in the scene (logo, keyLight, spinSpeed). Constants for
  tuned values go at the top of their file in upper snake case with a short comment saying why that value.
- **The code explains.** An agent reading `index.ts` tells the person what every effect on screen is and which call
  makes it, so the lesson reads in order and each call to the taught API is easy to find.
- **Comments say why.** Each file's header says what it holds; `index.ts`'s says what the example teaches. Inline
  comments explain a choice or an engine fact the code can't show ("Transmission needs the back buffer, so…"), never
  what the next line does. No commented-out code, no dashes as punctuation.
- **Show the API the way its authors mean.** Options objects at construction rather than a string of property sets
  after; the engine's helpers over hand-rolled maths. Read the JSDoc in `src/` for each API you use, and use the
  names it uses.
- **Small pieces with clear seams.** A function does one thing and is named for it. Files talk through the options
  they take and the objects they return, not shared mutable globals.
- **Per-frame code doesn't allocate.** The ticker reuses objects; no `new`, no array literals, no closures created
  per frame.
- **Typed.** No `any`, no casts that don't change the type, no non-null `!` without a reason.
- **Passes the checks.** `npx oxlint --deny-warnings <files>`, `npx oxfmt --write <files>`,
  `npx tsc --noEmit -p examples/tsconfig.json` and `npm run test:unused`.

## The README and the reference image

The README tells an agent what the example teaches and which API it uses before it opens the code; the reference
image is the picture the example should draw. `materials_clearcoat/README.md` is the model:

- **The title**, as the pane shows it, then a short paragraph: what the example teaches, what the picture shows, and
  the idea to leave with.
- **The picture**, `![…](reference.png)`, with alt text that describes it for a reader who can't see it.
- **API**: each API the example uses and what it does here, down to the options, properties and methods the lesson
  turns on. Every name the folder imports from `@pixi/3d`, `@pixi/3d/extras` and `pixi.js` appears in inline code;
  `npm run test:docs` checks.
- **Controls**: the pointer and the pane's rows.
- **Files**: a line for each file, then the theme kit pieces it uses.
- **See also**: up to three related examples, linked, with what each adds.
- **Reference image**: how it was taken, and the command that checks it.

`npm run test:example-shots` is the examples' visual test. It opens each example in the playground on WebGPU and
WebGL, at 1280 × 720 in the theme it opens on, and compares the page with its `reference.png` 30 frames after it comes
up. It runs on Playwright's fake clock, so the motion lands on the same frame every run. A shot fails when more than
0.5% of its pixels differ (a few examples that drift more get a wider margin), or when the page logs an error or a
warning. Name examples to shoot only those, as in `npm run test:example-shots -- materials_clearcoat`, and add
`--update` to retake a reference after an intended change. A failure leaves the expected, actual and diff images side
by side in `.pr_uploads/examples/`.

## Done means

- It renders the same on WebGPU and WebGL, on both themes, with no console errors or warnings.
- Its README describes it as it is, and `npm run test:example-shots -- <id>` passes.
- The frame shows the core of every concept the example names, and every pane control visibly changes it. Nothing on
  screen is code, a chart or a diagram, and nothing changes state unless the reader changes it.
- An agent that reads `index.ts` can explain every effect on screen and name the call that makes it, and a person
  could copy the folder, change it, and know which lines to change.
- It looks designed, and it sits with `theme-kit` and the examples already built as one collection.
- It holds 60 fps on a mid-range phone: a handful of draw calls and lights, and shadows only where they show.
