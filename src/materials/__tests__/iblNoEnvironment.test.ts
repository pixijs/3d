import { describe, expect, it } from 'vitest';

import { ColorCubeTexture } from '~/core/textures/ColorCubeTexture';
import { Material3D } from '~/materials/pbr/Material3D';
import { View3D } from '~/scene/View3D';

/** Names of the bits the material's primary shader is composed from under `view`, per backend */
function bitNames(material: Material3D, view: View3D): string[][] {
  const descriptor = material.getPrimaryDescriptor(view);
  return [descriptor.bitsGpu.map((bit) => bit.name), descriptor.bitsGl.map((bit) => bit.name)];
}

describe('Material3D IBL composition', () => {
  it('leaves the IBL block out when the view has no environment', () => {
    const view = new View3D({ width: 64, height: 64 });
    const material = new Material3D();

    try {
      for (const names of bitNames(material, view)) {
        // The environment contract stays: clearcoat, sheen and user bits may still call it.
        expect(names).toContain('envSourceDefault');
        expect(names).not.toContain('ibl');
      }
    } finally {
      material.destroy();
      view.destroy();
    }
  });

  it('composes the IBL block for a hemisphere and for a cubemap', () => {
    const cubeEnvironment = ColorCubeTexture.from(0xffffff);
    const cubeFaceSources = Object.values(cubeEnvironment.source.faces);
    const hemisphere = new View3D({
      width: 64,
      height: 64,
      environment: { skyColor: 0xffffff, groundColor: 0x000000 },
    });
    const cube = new View3D({ width: 64, height: 64, environment: cubeEnvironment });
    const hemisphereMaterial = new Material3D();
    const cubeMaterial = new Material3D();

    try {
      for (const names of bitNames(hemisphereMaterial, hemisphere)) expect(names).toContain('ibl');
      for (const names of bitNames(cubeMaterial, cube)) expect(names).toContain('ibl');
    } finally {
      hemisphereMaterial.destroy();
      cubeMaterial.destroy();
      hemisphere.destroy();
      cube.destroy();
      cubeEnvironment.destroy(true);
      for (const source of cubeFaceSources) source.destroy();
    }
  });

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
