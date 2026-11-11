/**
 * The pane: a Debug folder for the overlay and the captures, a Last capture folder that shows what the debugger read,
 * and a folder that makes the lesson's changes to the scene
 */

import type { ClayColor } from '../shared/theme/palette';
import type { ThemePane } from '../shared/theme/ThemePane';

/** What the Debug and Change the scene rows bind */
export interface DemoState {
  /** Whether the `GraphDebugOverlay` is on the page */
  overlay: boolean;
  /** Whether a capture runs four times a second */
  live: boolean;
  /** Whether the twin is in the scene */
  twin: boolean;
  twinVisible: boolean;
  puckColor: ClayColor;
  seeThrough: boolean;
}

/** What the last capture read, which `index.ts` writes and the read-only rows show */
export interface CaptureReadout {
  captureId: number;
  /** The passes that ran, in run order, one per line */
  passes: string;
  /** The opaque pass's meshes, its draw calls, and the meshes those draws drew */
  meshes: number;
  draws: number;
  drawn: number;
  /**
   * What the first capture after a change, or after a pass changed its draws by itself, says: reused, repacked or
   * rebuilt, and why
   */
  status: string;
  causes: string;
}

/** The lesson's changes, each a function in `index.ts` */
export interface SceneChanges {
  setOverlay: (on: boolean) => void;
  setTwin: (on: boolean) => void;
  setTwinVisible: (visible: boolean) => void;
  setPuckColor: (color: ClayColor) => void;
  setSeeThrough: (on: boolean) => void;
}

export interface ControlsOptions {
  pane: ThemePane;
  state: DemoState;
  readout: CaptureReadout;
  changes: SceneChanges;
  /** Takes one capture and logs it whole */
  captureNow: () => void;
}

/** The puck's colours, by the names `clayMaterial` takes */
const PUCK_OPTIONS = { lilac: 'lilac', orange: 'orange', sky: 'sky', pink: 'pink' } as const;
/** The octahedron's materials: its arc clay, or the see-through clay `index.ts` names `seeThrough` */
const OCTAHEDRON_OPTIONS = { clay: false, seeThrough: true };
/** A count the snapshot can leave null, which `index.ts` reads as NaN */
const COUNT = { readonly: true, format: (n: number) => (Number.isNaN(n) ? '-' : n.toFixed(0)) } as const;

export function createControls({ pane, state, readout, changes, captureNow }: ControlsOptions): void {
  const debug = pane.addFolder({ title: 'Debug' });

  debug.addBinding(state, 'overlay').on('change', ({ value }) => changes.setOverlay(value));
  debug.addBinding(state, 'live', { label: 'live capture' });
  debug.addButton({ title: 'Capture' }).on('click', captureNow);

  const last = pane.addFolder({ title: 'Last capture' });

  last.addBinding(readout, 'captureId', COUNT);
  last.addBinding(readout, 'passes', { readonly: true, multiline: true, rows: 5 });
  last.addBinding(readout, 'meshes', COUNT);
  last.addBinding(readout, 'draws', COUNT);
  last.addBinding(readout, 'drawn', COUNT);
  last.addBinding(readout, 'status', { readonly: true });
  last.addBinding(readout, 'causes', { readonly: true, multiline: true, rows: 2 });

  const scene = pane.addFolder({ title: 'Change the scene' });

  scene.addBinding(state, 'twin').on('change', ({ value }) => {
    changes.setTwin(value);
    // Hiding a mesh that isn't in the scene changes nothing in the frame.
    visibleRow.disabled = !value;
  });

  const visibleRow = scene
    .addBinding(state, 'twinVisible', { label: 'twin.visible' })
    .on('change', ({ value }) => changes.setTwinVisible(value));

  scene
    .addBinding(state, 'puckColor', { label: 'puck.material', options: PUCK_OPTIONS })
    .on('change', ({ value }) => changes.setPuckColor(value));
  // `octahedron.material` would wrap to two lines in the pane, so the row takes the mesh's name.
  scene
    .addBinding(state, 'seeThrough', { label: 'octahedron', options: OCTAHEDRON_OPTIONS })
    .on('change', ({ value }) => changes.setSeeThrough(value));
}
