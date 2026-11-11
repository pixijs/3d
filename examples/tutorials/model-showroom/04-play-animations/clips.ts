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
    /** -- INSERT CODE HERE -- */
  });

  const clips = {
    labels,
    current: labels[0],
    play(label: string) {
      /** -- INSERT CODE HERE -- */
    },
  };

  return clips;
}

export type Clips = ReturnType<typeof createClips>;
