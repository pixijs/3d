/**
 * One visual in the gallery as the pane sees it, and the set shape each visuals file returns
 *
 * `visuals.ts` and the files it builds from both import this, so it sits apart from them all.
 */

import type { Container3D } from '@pixi/3d';
import type { Container } from 'pixi.js';

import type { Label } from '../shared/theme/Label';

/** The pane folder a visual's row sits in */
export type VisualGroup = 'Helpers' | 'Lines and points' | 'Mesh and scene' | 'Overlays';

/** One visual in the gallery, which the pane shows or hides */
export interface GalleryVisual {
  /** Its class name, as its tag and its pane row show it */
  readonly name: string;
  readonly group: VisualGroup;
  /** Shows or hides it and its name tag */
  show(shown: boolean): void;
}

/** A few visuals built together, and their per-frame code */
export interface VisualSet {
  readonly visuals: GalleryVisual[];
  update(dt: number): void;
}

/** A visual whose parts show and hide together with its name tag; the inset's title is its name, so it has none */
export function visual(
  name: string,
  group: VisualGroup,
  parts: readonly (Container | Container3D)[],
  tag: Label | null,
): GalleryVisual {
  return {
    name,
    group,
    show(shown) {
      for (const part of parts) part.visible = shown;
      if (tag) tag.hidden = !shown;
    },
  };
}
