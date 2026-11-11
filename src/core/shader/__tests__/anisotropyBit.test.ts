import { describe, expect, it } from 'vitest';

import {
  anisotropyBit,
  anisotropyTangentBit,
  anisotropyTangentVariant,
  anisotropyTextureBit,
  anisotropyTextureTangentBit,
} from '~/core/shader/bits/anisotropyBit';
import { createLightingBit } from '~/core/shader/createLightingBit';

const hostLighting = createLightingBit({
  name: 'hostLightingAniso',
  preLighting: {
    gpu: 'var directLight = vec3<f32>(0.0);\nlet nDotV = max(dot(normal, viewDir), 0.0);\nlet a = roughness * roughness;',
    gl: 'vec3 directLight = vec3(0.0);\nfloat nDotV = max(dot(normal, viewDir), 0.0);\nfloat a = roughness * roughness;',
  },
  perLight: {
    gpu: `
      let halfVector = normalize(viewDir + lightDir);
      let nDotH = max(dot(normal, halfVector), 0.0);
      let fresnel = vec3<f32>(0.04);
      let specular = vec3<f32>(0.0);
      let radiance = light.color * attenuation;
      directLight += specular * radiance * nDotL * shadow;
    `,
    gl: `
      vec3 halfVector = normalize(viewDir + lightDir);
      float nDotH = max(dot(normal, halfVector), 0.0);
      vec3 fresnel = vec3(0.04);
      vec3 specular = vec3(0.0);
      vec3 radiance = light.color * attenuation;
      directLight += specular * radiance * nDotL * shadow;
    `,
  },
  postLighting: {
    gpu: 'finalColor = directLight;',
    gl: 'finalColor = directLight;',
  },
});

describe('anisotropyBit, a lobe that replaces the base specular rather than adding to it', () => {
  describe('metadata', () => {
    it('maps deriv bits to their tangent variants (and passes others through)', () => {
      expect(anisotropyTangentVariant(anisotropyBit)).toBe(anisotropyTangentBit);
      expect(anisotropyTangentVariant(anisotropyTextureBit)).toBe(anisotropyTextureTangentBit);
      expect(anisotropyTangentVariant(hostLighting)).toBe(hostLighting);
    });
  });
});
