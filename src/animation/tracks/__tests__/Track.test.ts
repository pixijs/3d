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
});
