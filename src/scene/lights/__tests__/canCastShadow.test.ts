import { describe, expect, it } from 'vitest';

import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import type { Light } from '~/scene/lights/Light';
import { PointLight } from '~/scene/lights/PointLight';
import { SpotLight } from '~/scene/lights/SpotLight';

describe('Light.canCastShadow', () => {
  it('follows castShadow on the kinds that can cast', () => {
    for (const light of [new DirectionalLight(), new SpotLight()]) {
      expect(light.canCastShadow).toBe(false);
      light.castShadow = true;
      expect(light.canCastShadow).toBe(true);
    }
  });

  it('stays false on point and ambient lights, whatever castShadow says', () => {
    const lights: Light[] = [new PointLight(), new AmbientLight()];

    for (const light of lights) {
      light.castShadow = true;
      expect(light.canCastShadow).toBe(false);
    }
  });
});
