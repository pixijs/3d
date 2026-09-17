import { Buffer, BufferUsage } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CameraData } from '~/core/CameraData';
import { releaseShadowCascades } from '~/core/render-passes/shadow/shadowPassUtils';
import type { ShadowData } from '~/scene/lights/Light';

describe('releaseShadowCascades', () => {
  it("frees each cascade's realized UBO buffer along with its bind group", () => {
    const cameraData = new CameraData();
    // In production the renderer realizes this on the cascade's first upload; nothing but this
    // release ever frees it (the cascade exempts it from pixi's GC — the recorded cascade
    // bundles reference it).
    cameraData.uniformGroup.buffer = new Buffer({ data: new Float32Array(16), usage: BufferUsage.UNIFORM });
    const data = { cascades: [{ cameraData }] } as unknown as ShadowData;

    releaseShadowCascades(data);

    expect(cameraData.uniformGroup.buffer.destroyed).toBe(true);
  });

  it('is a no-op for an empty slot and for a never-realized UBO', () => {
    const data = { cascades: [undefined, { cameraData: new CameraData() }] } as unknown as ShadowData;

    expect(() => releaseShadowCascades(data)).not.toThrow();
  });
});
