import { getApp } from '@test-utils';
import { Texture } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { getGlobalGlData } from '~/core/gl/shader/globalBitGl';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CUBETEXTURE_EMPTY, DEPTH_EMPTY } from '~/core/textures/DefaultTextures';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

interface ShadowPassProbe {
  renderTarget: { depthStencilTexture: unknown };
}

describe('GL global bind group shadow slot, which only the shadow pass binds, so its seed is what shadowless frames sample', () => {
  it('reads the comparison placeholder, the only kind a comparison sampler accepts, until a shadow frame binds the live map', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'shadow-map-slot-gl',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE },
    });

    try {
      const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
      app.stage.addChild(view3d);

      const { globalBindGroup: group, globalTextureBindings } = getGlobalGlData(view3d, app.renderer);
      const shadowMap = globalTextureBindings.shadowMap.slot;
      expect(group.getResource(shadowMap)).toBe(DEPTH_EMPTY.source);
      expect(group.getResource('uBonePitTexture')).toBe(Texture.EMPTY.source);
      expect(group.getResource('uEnvironmentTexture')).toBe(CUBETEXTURE_EMPTY.source);

      const ground = new Mesh3D({
        geometry: new PlaneGeometry({ width: 20, height: 20 }),
        material: new Material3D({ baseColor: 0x888888 }),
        castShadow: false,
      });
      ground.rotation.set(-Math.PI / 2, 0, 0);
      view3d.root.addChild(ground);

      app.render();
      expect(group.getResource(shadowMap), 'no light claims a slot, so the pass never runs').toBe(DEPTH_EMPTY.source);
      expect(group.getResource('uBonePitTexture')).toBe(view3d._bonePit.texture.source);

      const caster = new Mesh3D({
        geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
        material: new Material3D({ baseColor: 0x4a7c59 }),
        castShadow: true,
      });
      const sun = new DirectionalLight({ color: 0xffffff, intensity: 4, castShadow: true });
      sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
      view3d.root.addChild(caster, sun);

      app.render();
      const pass = view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassProbe;
      expect(group.getResource(shadowMap)).toBe(pass.renderTarget.depthStencilTexture);
    } finally {
      app.destroy();
    }
  });
});
