/**
 * The pane: a folder per effect, each bound straight to its filter or to the mask's settings
 *
 * Each folder has an `enabled` row and one value row. A skipped filter shows nothing at any value, so a value row
 * greys out while its effect is off, and ticking `enabled` brings the effect back at the value the row holds.
 */

import type { BindingApi } from '@tweakpane/core';
import type { AlphaFilter, BlurFilter, ColorMatrixFilter } from 'pixi.js';

import type { ThemePane } from '../shared/theme/ThemePane';

/** The mask's pane state; `drawMask()` and `applyMask()` in `index.ts` read it */
export interface MaskSettings {
  enabled: boolean;
  /** The rounded corners' radius, in px */
  radius: number;
}

export interface ControlsOptions {
  pane: ThemePane;
  blur: BlurFilter;
  colorMatrix: ColorMatrixFilter;
  fade: AlphaFilter;
  maskSettings: MaskSettings;
  /** Redraws the mask's shape from `maskSettings.radius` */
  drawMask: () => void;
  /** Puts the mask on the view or takes it off, from `maskSettings.enabled` */
  applyMask: () => void;
}

/** A value row's range and step, and how its value reads */
interface ValueParams {
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const oneDecimal = (value: number): string => value.toFixed(1);
const twoDecimals = (value: number): string => value.toFixed(2);

export function createControls({
  pane,
  blur,
  colorMatrix,
  fade,
  maskSettings,
  drawMask,
  applyMask,
}: ControlsOptions): void {
  // Past 6 the blur pulls in so much of the clear border round the view that the card's edge, and the mask's cut on it,
  // melts away.
  addEffect(pane, 'blur', blur, 'strength', { min: 0, max: 6, step: 0.1, format: oneDecimal });
  addEffect(pane, 'colorMatrix', colorMatrix, 'alpha', { min: 0, max: 1, step: 0.01, format: twoDecimals });

  const mask = addEffect(pane, 'mask', maskSettings, 'radius', { min: 0, max: 200, step: 1, format: String });

  mask.enabled.on('change', applyMask);
  mask.value.on('change', drawMask);

  addEffect(pane, 'fade', fade, 'alpha', { min: 0, max: 1, step: 0.01, format: twoDecimals });
}

/** Adds a folder of `target`'s `enabled` row and its `key` row, which greys out while `enabled` is off */
function addEffect<T extends { enabled: boolean }>(
  pane: ThemePane,
  title: string,
  target: T,
  key: keyof T & string,
  params: ValueParams,
): { enabled: BindingApi; value: BindingApi } {
  const folder = pane.addFolder({ title });
  const enabled = folder.addBinding(target, 'enabled');
  const value = folder.addBinding(target, key, { ...params, disabled: !target.enabled });

  enabled.on('change', ({ value: on }) => {
    value.disabled = !on;
  });

  return { enabled, value };
}
