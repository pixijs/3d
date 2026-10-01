import { Buffer, BufferUsage } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CameraData } from '~/core/CameraData';
import { releaseShadowCascades } from '~/core/render-passes/shadow/shadowPassUtils';
import type { ShadowData } from '~/scene/lights/Light';

describe('releaseShadowCascades', () => {
  it("frees each cascade's realized UBO buffer along with its bind group, which nothing else frees on WebGPU", () => {
    const cameraData = new CameraData();
    cameraData.uniformGroup.buffer = new Buffer({ data: new Float32Array(16), usage: BufferUsage.UNIFORM });
    const data = { cascades: [{ cameraData }] } as unknown as ShadowData;

    releaseShadowCascades(data);

    expect(cameraData.uniformGroup.buffer.destroyed).toBe(true);
  });
});
