/**
 * The pane: `antialias`, which reloads the page; the three effects' `enabled` flags; two read-only rows, the
 * anti-aliasing the view gets and the wire's width in the loupe; and FXAA's three knobs, greyed out while FXAA is off
 */

import type { FxaaEffect, SsaoEffect, TintEffect } from '@pixi/3d/extras';

import type { ThemePane } from '../shared/theme/ThemePane';
import type { ThemeStage } from '../shared/theme/ThemeStage';

export interface ControlsOptions {
  pane: ThemePane;
  stage: ThemeStage;
  /** `antialias` as the canvas was made */
  antialias: boolean;
  effect: TintEffect;
  ssao: SsaoEffect;
  fxaa: FxaaEffect;
  /** The anti-aliasing the view gets now */
  antiAliasing: () => string;
  /** The wire's width on screen at the loupe, in canvas pixels */
  wire: { readonly wireWidth: number };
}

/** The thresholds' readout, to the three decimals FXAA's defaults are written in */
const THREE_DECIMALS = { format: (value: number) => value.toFixed(3) };

export function createControls({
  pane,
  stage,
  antialias,
  effect,
  ssao,
  fxaa,
  antiAliasing,
  wire,
}: ControlsOptions): void {
  pane.addBinding({ antialias }, 'antialias').on('change', ({ value }) => reloadWith(value));
  pane.addBinding(effect, 'enabled', { label: 'effect.enabled' });
  pane.addBinding(ssao, 'enabled', { label: 'ssao.enabled' });

  const fxaaRow = pane.addBinding(fxaa, 'enabled', { label: 'fxaa.enabled' });

  pane.addBinding(
    {
      get value() {
        return antiAliasing();
      },
    },
    'value',
    { label: 'In use', readonly: true },
  );
  pane.addBinding(wire, 'wireWidth', {
    label: 'Wire width',
    readonly: true,
    format: (px: number) => `${px.toFixed(1)} px`,
  });

  const knobs = pane.addFolder({ title: 'fxaa' });

  // Each runs from its default to past the far rail's contrast, where the loupe's steps come back: below the default
  // the rail looks the same.
  knobs.addBinding(fxaa, 'edgeThreshold', { min: 0.125, max: 0.35, step: 0.005, ...THREE_DECIMALS });
  // Two rows, since the label column is too narrow for the whole name on one.
  knobs.addBinding(fxaa, 'edgeThresholdMin', {
    label: 'edgeThreshold\nMin',
    min: 0.05,
    max: 0.3,
    step: 0.005,
    ...THREE_DECIMALS,
  });
  knobs.addBinding(fxaa, 'edgeSharpness', {
    options: [
      { text: '2 (softest)', value: 2 },
      { text: '4', value: 4 },
      { text: '8 (sharpest)', value: 8 },
    ],
  });
  knobs.disabled = !fxaa.enabled;
  fxaaRow.on('change', ({ value }) => (knobs.disabled = !value));

  /** `antialias` can't change on a live canvas, so the page reloads with it, and with the effects as they are */
  function reloadWith(value: boolean): void {
    const url = new URL(location.href);

    url.searchParams.set('antialias', value ? 'on' : 'off');
    url.searchParams.set('effect', effect.enabled ? 'on' : 'off');
    url.searchParams.set('ssao', ssao.enabled ? 'on' : 'off');
    url.searchParams.set('fxaa', fxaa.enabled ? 'on' : 'off');
    url.searchParams.set('theme', stage.theme);
    location.replace(url);
  }
}
