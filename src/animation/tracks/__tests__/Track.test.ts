import { describe, expect, it } from 'vitest';

import { Track } from '~/animation/tracks/Track';

describe('Track', () => {
  it('STEP holds the prior keyframe across all components', () => {
    const track = new Track({
      label: 'n.weights',
      times: [0, 1],
      values: [0.25, 0.75, 1, 0],
      interpolation: 'STEP',
      valueSize: 2,
    });

    const out = new Float32Array(2);
    track.evaluate(0.9, 0, out);

    expect(out[0]).toBeCloseTo(0.25);
    expect(out[1]).toBeCloseTo(0.75);
  });

  it('clamps to the first and last keyframes at the boundaries', () => {
    const track = new Track({
      label: 'n.weights',
      times: [0, 1, 2],
      values: [0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1],
      interpolation: 'LINEAR',
      valueSize: 3,
    });

    const start = new Float32Array(3);
    track.evaluate(-1, 0, start);
    expect(Array.from(start)).toEqual([0, 0, 0]);

    const end = new Float32Array(3);
    track.evaluate(5, 0, end);
    expect(Array.from(end)).toEqual([1, 1, 1]);
  });

  it('finds the same keyframe from a hint ahead of the time as from 0', () => {
    const times = Array.from({ length: 101 }, (_, key) => key / 10);
    const track = new Track({ label: 'n.x', times, values: times.map((time) => time * 2) });
    const fromHint = new Float32Array(1);
    const fromStart = new Float32Array(1);

    for (let hint = 1; hint < 100; hint++) {
      for (const time of [0.05, 2.5, 3, 4.95, hint / 10 - 0.01]) {
        expect(track.evaluate(time, hint, fromHint)).toBe(track.evaluate(time, 0, fromStart));
        expect(fromHint[0]).toBe(fromStart[0]);
      }
    }
  });
});
