import { DEG_TO_RAD } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { LightDataList } from '~/core/LightDataList';
import { SpotLight } from '~/scene/lights/SpotLight';

/**
 * Pins the fix for issue #60: `SpotLight.penumbra` must flow into the packed
 * light list.
 *
 * Layout (see LightDataList):
 *   [11] = outer coneCos  = cos(coneAngle)
 *   [12] = inner coneCos  = cos(coneAngle * (1 - penumbra))
 * with coneAngle converted from degrees to radians.
 */
describe('SpotLight penumbra → packed light list', () => {
  it('writes outer and inner coneCos to slots [11] and [12]', () => {
    const coneAngle = 25;
    const penumbra = 0.3;
    const light = new SpotLight({ coneAngle, penumbra });
    const list = new LightDataList();
    list.add(light);

    const radians = coneAngle * DEG_TO_RAD;

    expect(list.data[11]).toBeCloseTo(Math.cos(radians));
    expect(list.data[12]).toBeCloseTo(Math.cos(radians * (1 - penumbra)));
    // Inner cone sits *inside* the outer cone, so its cosine is larger.
    expect(list.data[12]).toBeGreaterThan(list.data[11]);
  });

  it('collapses inner onto outer when penumbra is 0 (hard edge)', () => {
    const light = new SpotLight({ coneAngle: 45, penumbra: 0 });
    const list = new LightDataList();
    list.add(light);

    expect(list.data[12]).toBeCloseTo(list.data[11]);
  });
});
