/**
 * The pane: the interpolation every track uses, play and stop, the time to scrub to, and the light's intensity
 *
 * Each row calls a function from `index.ts`, so every engine call the lesson teaches stays there. This file keeps the
 * rows showing what the player does.
 */

import type { AnimationState, InterpolationMode, PointLight } from '@pixi/3d';

import type { ThemePane } from '../shared/theme/ThemePane';
import { INTERPOLATIONS } from './keyframes';

export interface ControlsOptions {
  pane: ThemePane;
  /** The interpolation the playback starts in */
  interpolation: InterpolationMode;
  /** The animation's length in seconds, the time row's range */
  duration: number;
  /** The light the NumberTrack drives, whose intensity a read-only row shows */
  flash: PointLight;
  onInterpolation: (mode: InterpolationMode) => void;
  onPlay: (play: boolean) => void;
  /** Stops the playback at a time and shows its pose */
  onScrub: (time: number) => void;
}

export interface Controls {
  /** Shows whether the playback plays and its time; call it each frame */
  sync(playback: AnimationState): void;
}

/** The interpolation row's options, each shown as its own name */
const OPTIONS = Object.fromEntries(INTERPOLATIONS.map((mode) => [mode, mode]));

export function createControls(options: ControlsOptions): Controls {
  const { pane, interpolation, duration, flash, onInterpolation, onPlay, onScrub } = options;
  // What the rows show; sync writes the playback's own values in before the first frame.
  const params = { interpolation, play: true, time: 0 };
  // A refresh fires the row's change handler too, so the handlers ignore what sync writes.
  let syncing = false;

  pane.addBinding(params, 'interpolation', { options: OPTIONS }).on('change', ({ value }) => onInterpolation(value));

  // Plain words, since `playing` is a getter: the row calls play() and stop().
  const playRow = pane.addBinding(params, 'play', { label: 'Play' });
  const timeRow = pane.addBinding(params, 'time', { min: 0, max: duration, step: 0.01 });

  playRow.on('change', ({ value }) => {
    if (!syncing) onPlay(value);
  });
  timeRow.on('change', ({ value }) => {
    if (!syncing) onScrub(value);
  });
  pane.addBinding(flash, 'intensity', { readonly: true, format: (v) => v.toFixed(1) });

  /** Shows a row's new value without its change handler taking it for the reader's */
  function refresh(row: { refresh(): void }): void {
    syncing = true;
    row.refresh();
    syncing = false;
  }

  return {
    sync(playback) {
      // The slider's own step, so a stopped playhead holds the row still.
      const time = Math.round(playback.time * 100) / 100;

      if (playback.playing !== params.play) {
        params.play = playback.playing;
        refresh(playRow);
      }
      if (time !== params.time) {
        params.time = time;
        refresh(timeRow);
      }
    },
  };
}
