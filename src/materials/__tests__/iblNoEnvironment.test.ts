import { describe, expect, it } from 'vitest';

import { Material3D } from '~/materials/pbr/Material3D';
import { View3D } from '~/scene/View3D';

function bitNames(material: Material3D, view: View3D): string[][] {
  const descriptor = material.getPrimaryDescriptor(view);
  return [descriptor.bitsGpu.map((bit) => bit.name), descriptor.bitsGl.map((bit) => bit.name)];
}

describe('Material3D IBL composition', () => {
  it('picks the IBL block up when a view gains an environment, and drops it when it loses one', () => {
    const view = new View3D({ width: 64, height: 64 });
    const material = new Material3D();

    try {
      for (const names of bitNames(material, view)) expect(names).not.toContain('ibl');

      view.environment = { skyColor: 0xffffff, groundColor: 0x000000 };
      for (const names of bitNames(material, view)) expect(names).toContain('ibl');

      view.environment = null;
      for (const names of bitNames(material, view)) expect(names).not.toContain('ibl');
    } finally {
      material.destroy();
      view.destroy();
    }
  });
});
