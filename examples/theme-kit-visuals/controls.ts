/** The pane: the theme, and a row per visual that shows or hides it, in a folder for each kind */

import type { FolderApi } from 'tweakpane';

import { ThemePane } from '../shared/theme/ThemePane';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import type { GalleryVisual, VisualGroup } from './visuals';

/** The folders, in the order the stations read: the small helpers first, the 2D overlays last */
const GROUPS: readonly VisualGroup[] = ['Helpers', 'Lines and points', 'Mesh and scene', 'Overlays'];
/** The checkbox column's width in px, narrow enough that 'DimensionHelper' reads whole beside it */
const VALUE_WIDTH = 80;

export interface ControlsOptions {
  title: string;
  stage: ThemeStage;
  visuals: readonly GalleryVisual[];
  /** Whether the pane opens expanded; collapsed, it's a bar the stations stay under */
  expanded: boolean;
}

export function createControls({ title, stage, visuals, expanded }: ControlsOptions): ThemePane {
  const pane = new ThemePane({ title, stage, expanded });
  const shown = Object.fromEntries(visuals.map((v) => [v.name, true]));
  const folders: FolderApi[] = [];

  // Tweakpane works out the value column's width on the pane's root, and every row takes it from there. A checkbox
  // needs little room, so the class names get the rest of the row.
  pane.element.style.setProperty('--tp-blade-value-width', `${VALUE_WIDTH}px`);

  for (const group of GROUPS) {
    const folder = pane.addFolder({ title: group, expanded: false });

    folders.push(folder);
    // One folder open at a time, so the pane stays a short column clear of the inset under it.
    folder.on('fold', ({ expanded: opened }) => {
      if (opened) for (const other of folders) other.expanded = other === folder;
    });
    for (const v of visuals) {
      if (v.group === group) folder.addBinding(shown, v.name).on('change', ({ value }) => v.show(value));
    }
  }

  return pane;
}
