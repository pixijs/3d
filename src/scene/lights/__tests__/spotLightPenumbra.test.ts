import { DEG_TO_RAD } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { LightDataListBuffer } from '~/core/buffers/LightDataListBuffer';
import { SpotLight } from '~/scene/lights/SpotLight';

/**
 * Pins the fix for issue #60: `SpotLight.penumbra` must flow into the GPU
 * light buffer.
 *
 * Buffer layout (see LightDataListBuffer):
 *   [11] = outer coneCos  = cos(coneAngle)
 *   [12] = inner coneCos  = cos(coneAngle * (1 - penumbra))
 * with coneAngle converted from degrees to radians.
 */
describe('SpotLight penumbra → GPU buffer', () => {
  it('writes outer and inner coneCos to slots [11] and [12]', () => {
    const coneAngle = 25;
    const penumbra = 0.3;
    const light = new SpotLight({ coneAngle, penumbra });
    const buffer = new LightDataListBuffer();
    buffer.add(light);

    const radians = coneAngle * DEG_TO_RAD;

    expect(buffer.data[11]).toBeCloseTo(Math.cos(radians));
    expect(buffer.data[12]).toBeCloseTo(Math.cos(radians * (1 - penumbra)));
    // Inner cone sits *inside* the outer cone, so its cosine is larger.
    expect(buffer.data[12]).toBeGreaterThan(buffer.data[11]);
  });

  it('collapses inner onto outer when penumbra is 0 (hard edge)', () => {
    const light = new SpotLight({ coneAngle: 45, penumbra: 0 });
    const buffer = new LightDataListBuffer();
    buffer.add(light);

    expect(buffer.data[12]).toBeCloseTo(buffer.data[11]);
  });
});
