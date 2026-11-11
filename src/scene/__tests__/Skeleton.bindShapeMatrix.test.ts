import { describe, expect, it } from 'vitest';

import { Skeleton } from '~/scene/Skeleton';

function scaleAndMove(scale: number, x: number): Float32Array {
  return new Float32Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, 0, 0, 1]);
}

const X_TRANSLATION_SLOT = 3;

describe('Skeleton bindShapeMatrix', () => {
  it('cancels the bind shape matrix once, at the root, so every bone is relative to the mesh', () => {
    const inverseBindMatrices = new Float32Array(32);

    inverseBindMatrices.set(scaleAndMove(1, 0), 0);
    inverseBindMatrices.set(scaleAndMove(1, 0), 16);

    const skeleton = new Skeleton({
      parent: new Int16Array([-1, 0]),
      joints: new Int16Array([0, 1]),
      inverseBindMatrices,
      bindShapeMatrix: scaleAndMove(2, 10),
    });

    skeleton.setLocalTRS(1, 4, 0, 0, 0, 0, 0, 1);
    skeleton.updateWorld();

    expect(skeleton.worldMatrix[0]).toBe(0.5);
    expect(skeleton.worldMatrix[X_TRANSLATION_SLOT]).toBe(-5);
    expect(skeleton.worldMatrix[12]).toBe(0.5);
    expect(skeleton.worldMatrix[12 + X_TRANSLATION_SLOT], 'the child moves 4, then the root cancels').toBe(-3);
  });

  it('throws on a bind shape matrix that has no inverse', () => {
    expect(
      () =>
        new Skeleton({
          parent: new Int16Array([-1]),
          joints: new Int16Array([0]),
          inverseBindMatrices: scaleAndMove(1, 0),
          bindShapeMatrix: new Float32Array(16),
        }),
    ).toThrow("can't invert matrix");
  });
});
