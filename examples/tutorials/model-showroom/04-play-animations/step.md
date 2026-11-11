---
title: Play animations
---

The fox file holds three animations: Survey, Walk and Run. In this step you'll play them, and fade from one to the next instead of cutting.

`index.ts` now calls `createClips` in `clips.ts` with the fox's animation player. It also switches to the next animation every three seconds, so you can watch the fades. Work in `clips.ts`.

## The player and its states

A model whose file has animations gets an {@link AnimationPlayer} as its {@link Model3D#player | player}, and `index.ts` passes `fox.player` to `createClips`. The starting code already uses it:

- {@link AnimationPlayer#animationLabels | animationLabels} lists the animations by their names in the file.
- {@link AnimationPlayer#getState | getState} returns the {@link AnimationState} for one animation without starting it. A state holds that animation's playback: its time, speed and weight.
- `active.play()` starts the first one, Survey.

## Fade

A player applies every animation that's playing, and where two move the same bone of the fox's skeleton, it mixes them by {@link AnimationState#weight | weight}. So a fade moves the weight from one animation to another, a step each frame. Fill in the ticker callback:

```ts
const step = ticker.deltaMS / FADE_MS;

for (const state of states) {
  if (state === active) {
    state.weight = Math.min(1, state.weight + step);
  } else if (state.playing) {
    state.weight = Math.max(0, state.weight - step);
    if (state.weight === 0) state.stop();
  }
}
```

Stepping by `ticker.deltaMS / FADE_MS` makes a fade take 400 milliseconds whatever the display's refresh rate. Once an animation has faded out, {@link AnimationState#stop | stop} takes it out of the mix.

## Switch

Fill in `play`, which makes another animation the active one:

```ts
active = player.getState(label);
if (!active.playing) {
  active.weight = 0;
  active.play();
}
clips.current = label;
```

- From the next frame, the ticker moves the weight over to the new active animation.
- A state that isn't playing starts again at weight 0, so it fades in from nothing. Without the reset, an animation's first play would jump in, since a state's weight is 1 until you set it.
- {@link AnimationState#play | play} picks a stopped animation up where it stopped.
- An animation still fading out is still playing, so picking it again turns its fade around. Every weight carries on from where it was, so switching mid-fade never jumps.
- `clips.current` keeps the label, for the buttons and the tag you'll add later.

Every three seconds the fox now eases from surveying to walking to running, and round again. [Animation](../../../../src/animation/__docs__/animation.md#blending-and-crossfades) covers blending further. In the next step, buttons take over.
