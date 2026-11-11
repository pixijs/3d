/**
 * The pane: a folder for the toon material's values and one for the outline pass
 *
 * Each folder's rows bind to the options object its half was built from, and a change goes through the function
 * `index.ts` hands in, so every material and pass call stays there.
 */

import type { ThemePane } from '../shared/theme/ThemePane';

export interface ControlsOptions {
  pane: ThemePane;
  /** The values every toon material was built from */
  toon: { bands: number; specularSize: number; rimIntensity: number; rimPower: number };
  /** The options the outline pass was built from */
  outline: { width: number; color: number; enabled: boolean };
  /** Writes `toon` into every toon material */
  onToon: () => void;
  /** Builds a pass with `outline`'s width and colour in place of the old one */
  onOutline: () => void;
  /** Writes `outline.enabled` into the pass */
  onEnabled: () => void;
}

/** Up to 0.1 local units, 2.5 times the starting width; each step is a shader, so a drag builds at most 21 */
const WIDTH_RANGE = { min: 0, max: 0.1, step: 0.005 };

const twoDecimals = (value: number): string => value.toFixed(2);

export function createControls({ pane, toon, outline, onToon, onOutline, onEnabled }: ControlsOptions): void {
  const toonFolder = pane.addFolder({ title: 'ToonMaterial' });

  toonFolder.addBinding(toon, 'bands', { min: 1, max: 8, step: 1 }).on('change', onToon);
  toonFolder.addBinding(toon, 'specularSize', { min: 0, max: 0.3, format: twoDecimals }).on('change', onToon);
  toonFolder.addBinding(toon, 'rimIntensity', { min: 0, max: 1, format: twoDecimals }).on('change', onToon);
  toonFolder
    .addBinding(toon, 'rimPower', { min: 0.5, max: 8, format: (value) => value.toFixed(1) })
    .on('change', onToon);

  const outlineFolder = pane.addFolder({ title: 'OutlinePass' });

  outlineFolder
    .addBinding(outline, 'width', { ...WIDTH_RANGE, format: (value) => value.toFixed(3) })
    .on('change', onOutline);
  // The renderer keeps every colour's shader, so a drag across the picker builds one pass, when it ends.
  outlineFolder.addBinding(outline, 'color', { view: 'color' }).on('change', ({ last }) => {
    if (last) onOutline();
  });
  outlineFolder.addBinding(outline, 'enabled').on('change', onEnabled);
}
