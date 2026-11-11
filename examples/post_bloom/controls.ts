/** The pane: the bloom's settings, the view's tone mapping and the logo's emissive strength, a folder each */

import type { EmissiveProps, ToneMapping, View3D } from '@pixi/3d';
import type { BloomEffectOptions } from '@pixi/3d/extras';

import type { ThemePane } from '../shared/theme/ThemePane';

/**
 * The bloom's settings as the pane holds them. `levels` and `resolution` are read-only on the effect, and the effect
 * is replaced when they change, so the pane binds this object rather than the effect
 */
export type BloomSettings = Required<Omit<BloomEffectOptions, 'stage'>>;

export interface ControlsOptions {
  pane: ThemePane;
  settings: BloomSettings;
  /** The view whose `toneMapping` the pane switches */
  view3d: View3D;
  /** The logo's glow, `neon.emissive` */
  neonEmissive: EmissiveProps;
  /** Applies `settings` to the effect after any bloom row changes */
  onBloomChange: () => void;
}

/** The curve the kit's colours are picked for, and the filmic curve that rolls bright light off */
const CURVES: Record<string, ToneMapping> = { none: 'none', aces: 'aces' };

export function createControls({ pane, settings, view3d, neonEmissive, onBloomChange }: ControlsOptions): void {
  const bloom = pane.addFolder({ title: 'bloom' });

  bloom.addBinding(settings, 'enabled').on('change', onBloomChange);
  bloom.addBinding(settings, 'threshold', { min: 0, max: 4, step: 0.01 }).on('change', onBloomChange);
  bloom.addBinding(settings, 'intensity', { min: 0, max: 4, step: 0.01 }).on('change', onBloomChange);
  bloom.addBinding(settings, 'radius', { min: 0, max: 1, step: 0.01 }).on('change', onBloomChange);
  bloom.addBinding(settings, 'levels', { min: 1, max: 8, step: 1 }).on('change', onBloomChange);
  bloom
    .addBinding(settings, 'resolution', { options: { '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125 } })
    .on('change', onBloomChange);

  // A new curve rebuilds the view's render graph, fine for a switch.
  pane.addFolder({ title: 'view3d' }).addBinding(view3d, 'toneMapping', { options: CURVES });
  pane.addFolder({ title: 'neon.emissive' }).addBinding(neonEmissive, 'strength', { min: 0, max: 8, step: 0.01 });
}
