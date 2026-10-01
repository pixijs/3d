import { DEG_TO_RAD } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { LightDataList } from '~/core/LightDataList';
import { SpotLight } from '~/scene/lights/SpotLight';

const OUTER_CONE_COS_SLOT = 11;
const INNER_CONE_COS_SLOT = 12;

describe('SpotLight penumbra → packed light list', () => {
  it('packs the cosine of the cone angle, and of the inner cone the penumbra narrows it to', () => {
    const coneAngle = 25;
    const penumbra = 0.3;
    const light = new SpotLight({ coneAngle, penumbra });
    const list = new LightDataList();
    list.add(light);

    const radians = coneAngle * DEG_TO_RAD;

    expect(list.data[OUTER_CONE_COS_SLOT]).toBeCloseTo(Math.cos(radians));
    expect(list.data[INNER_CONE_COS_SLOT]).toBeCloseTo(Math.cos(radians * (1 - penumbra)));
    expect(list.data[INNER_CONE_COS_SLOT]).toBeGreaterThan(list.data[OUTER_CONE_COS_SLOT]);
  });
});
