/**
 * `Track.evaluate`, the per-track sample every playing animation state takes once a frame, timed in Node. Each call
 * finds the keyframe pair around the time, from the index it found last frame as a hint, and interpolates between
 * them, so the cost of a call is the search from that hint as much as the interpolation.
 *
 * The workload is 64 position tracks of 301 keys each (10 s baked at 30 Hz), sampled over one whole loop of the clip
 * at 60 Hz: 38,400 calls a sample. Every track keeps its own hint, carried from call to call as `AnimationState`
 * keeps them. A sample is a whole loop, so replaying it is the loop's own wrap and no sample carries a jump the
 * playback would not make.
 *
 * Forward playback moves the time past the hint by at most a key a frame. Backward playback (`animationSpeed < 0`)
 * puts the time behind the hint on every frame, so every call has to search back from it, which forward playback
 * never asks for. Each direction is its own bench.
 */

import { Vector3Track } from '@pixi/3d';
import { cpu } from 'benchy';

import { mulberry32 } from './data/rng.ts';

const TRACKS = 64;
const KEY_RATE = 30;
const CLIP_SECONDS = 10;
const STEP = 1 / 60;
const FRAMES = CLIP_SECONDS * 60;

/** Baked position tracks: a key every 1 / 30 s over the clip, each a random walk of its own. */
function tracks(): Vector3Track[] {
  const random = mulberry32(0x7ac4_5eed);
  const keys = KEY_RATE * CLIP_SECONDS + 1;
  const times = Float32Array.from({ length: keys }, (_, key) => key / KEY_RATE);
  return Array.from({ length: TRACKS }, (_, track) => {
    const values = new Float32Array(keys * 3);
    for (let at = 3; at < values.length; at++) values[at] = (values[at - 3] ?? 0) + random() - 0.5;
    return new Vector3Track({ label: `bone${track}.position`, times, values });
  });
}

/**
 * The frames an animation state samples over one loop from 0 s, forward or backward, wrapped into the clip the way a
 * looping state wraps its time.
 */
function playhead(direction: 1 | -1): Float64Array {
  return Float64Array.from({ length: FRAMES }, (_, frame) => {
    const time = (direction * frame * STEP) % CLIP_SECONDS;
    return time < 0 ? time + CLIP_SECONDS : time;
  });
}

/**
 * One sample: every track evaluated at every frame of the playhead, each with its own hint as `AnimationState`
 * keeps them. The hints carry over from sample to sample, as they do from frame to frame, and the playhead is
 * replayed, so every sample does the same searches.
 * @param times - The playhead, one time a frame
 * @yields The timed sample and its snapshot
 */
function* sampleTracks(times: Float64Array) {
  const subjects = tracks();
  const hints = new Int32Array(TRACKS);
  const out = new Float32Array(3);
  let sum = 0;
  yield {
    bench: () => {
      let checksum = 0;
      for (let frame = 0; frame < times.length; frame++) {
        const time = times[frame] ?? 0;
        for (let track = 0; track < subjects.length; track++) {
          const hint = subjects[track]?.evaluate(time, hints[track] ?? 0, out) ?? 0;
          hints[track] = hint;
          checksum += out[0] + out[1] * 0.5 + out[2] * 0.25 + hint;
        }
      }
      sum = checksum;
      return checksum;
    },
    // The checksum reads every key found and every value written; the hints are where the last frame left them.
    snapshot: () => [sum, ...Array.from(hints)],
  };
}

cpu('track search, forward playback', function* () {
  return yield* sampleTracks(playhead(1));
});

cpu('track search, backward playback', function* () {
  return yield* sampleTracks(playhead(-1));
});
