import type { AnimationPlayer } from '@pixi/3d';
import type { Application } from 'pixi.js';

// How long a crossfade from one animation to the next takes, in milliseconds
const FADE_MS = 400;

export function createClips(app: Application, player: AnimationPlayer) {
  // The model's animations, by the names the file gives them
  const labels = player.animationLabels;
  // One state for each: the object that holds that animation's time, speed and weight
  const states = labels.map((label) => player.getState(label));
  let active = states[0];

  active.play();

  // Every frame, move the active animation's weight a step toward 1, and any other playing one's toward 0
  app.ticker.add((ticker) => {
    const step = ticker.deltaMS / FADE_MS;

    for (const state of states) {
      if (state === active) {
        state.weight = Math.min(1, state.weight + step);
      } else if (state.playing) {
        state.weight = Math.max(0, state.weight - step);
        // Once it has faded out, stop it
        if (state.weight === 0) state.stop();
      }
    }
  });

  const clips = {
    labels,
    current: labels[0],
    play(label: string) {
      active = player.getState(label);
      // An animation that isn't playing starts at weight 0, so it fades in
      if (!active.playing) {
        active.weight = 0;
        active.play();
      }
      clips.current = label;
    },
  };

  return clips;
}

export type Clips = ReturnType<typeof createClips>;
