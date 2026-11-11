import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const GUARANTEED_FRAGMENT_VECTORS = 224;
const GUARANTEED_VERTEX_VECTORS = 256;

const ROWS: Record<string, number> = { mat4: 4, mat3: 3, mat2: 2 };

function defaultBlockVectors(source: string): number {
  const plain = source.replace(/uniform\s+\w+\s*\{[^}]*\}\s*\w*\s*;/g, '');
  let vectors = 0;
  for (const [, type, size] of plain.matchAll(
    /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+\w+\s*(?:\[\s*(\d+)\s*\])?\s*;/gm,
  )) {
    if (!type.includes('ampler')) vectors += (ROWS[type] ?? 1) * Number(size ?? 1);
  }
  return vectors;
}

describe('WebGL uniform vector budget', () => {
  it('keeps a lit, shadowed shader inside the limits WebGL2 guarantees, and still draws it', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'uniform-vector-budget-gl',
      appOptions: { preference: 'webgl', width: 64, height: 64 },
    });
    const gl = app.renderer.gl;
    const sources: { type: number; source: string }[] = [];
    const shaderSource = gl.shaderSource.bind(gl);

    gl.shaderSource = (shader: WebGLShader, source: string) => {
      sources.push({ type: gl.getShaderParameter(shader, gl.SHADER_TYPE), source });
      shaderSource(shader, source);
    };

    try {
      const view3d = new View3D({ width: 64, height: 64 });
      const sun = new DirectionalLight({ intensity: 3, castShadow: true });
      sun.position.set(5, 8, 5);
      sun.lookAt({ x: 0, y: 0, z: 0 });
      view3d.root.addChild(sun);

      const ground = new Mesh3D({ geometry: new PlaneGeometry({ width: 10, height: 10 }), material: new Material3D() });
      ground.rotation.set(-Math.PI / 2, 0, 0);
      view3d.root.addChild(ground);

      const ball = new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D() });
      ball.position.set(0, 1, 0);
      view3d.root.addChild(ball);

      view3d.camera.position.set(0, 3, 6);
      view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
      app.stage.addChild(view3d);
      app.render();
      app.render();

      const lit = sources.filter(({ source }) => source.includes('uniform global {'));
      expect(lit.length, 'the lit shaders compiled with the global uniform block').toBeGreaterThan(0);
      expect(
        sources.some(({ source }) => source.includes('calculateShadow') && source.includes('uniform global {')),
        'the shadow-sampling variant is among them',
      ).toBe(true);

      for (const { type, source } of sources) {
        const limit = type === gl.FRAGMENT_SHADER ? GUARANTEED_FRAGMENT_VECTORS : GUARANTEED_VERTEX_VECTORS;
        expect(defaultBlockVectors(source)).toBeLessThanOrEqual(limit);
      }
      expect(gl.getError()).toBe(gl.NO_ERROR);
    } finally {
      app.destroy(true, { children: true });
    }
  });
});
