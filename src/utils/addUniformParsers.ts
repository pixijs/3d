import type { UniformData } from 'pixi.js';
import { uniformParsers } from 'pixi.js';

/**
 * The `vec3<f32>` tests check `type` because pixi's uniform-buffer path doesn't, and the `mat3x3` buffer write
 * skips every fourth float, the padding a uniform buffer gives each column
 * @internal
 */
export function addUniformParsers(): void {
  uniformParsers.push({
    type: 'mat4x4<f32>',
    test: (data: UniformData) => (data.value as { elements?: ArrayLike<number> }).elements?.length === 16,
    uniform: `
        gl.uniformMatrix4fv(ud[name].location, false, uv[name].elements);
        `,
    ubo: `
        var v = uv[name].elements;
        for(var i=0;i<16;i++)
        {
            data[offset + i] = v[i];
        }
    `,
  });

  uniformParsers.push({
    type: 'mat3x3<f32>',
    test: (data: UniformData) => (data.value as { elements?: ArrayLike<number> }).elements?.length === 9,
    uniform: `
        gl.uniformMatrix3fv(ud[name].location, false, uv[name].elements);
        `,
    ubo: `
        var v = uv[name].elements;
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];
        data[offset + 4] = v[3];
        data[offset + 5] = v[4];
        data[offset + 6] = v[5];
        data[offset + 8] = v[6];
        data[offset + 9] = v[7];
        data[offset + 10] = v[8];
    `,
  });

  uniformParsers.push({
    type: 'vec3<f32>',
    test: (data: UniformData) =>
      data.type === 'vec3<f32>' && data.size === 1 && (data.value as { x?: number }).x !== undefined,
    uniform: `
        cv = ud[name].value;
        v = uv[name];

        if(cv[0] !== v.x || cv[1] !== v.y || cv[2] !== v.z)
        {
            cv[0] = v.x;
            cv[1] = v.y;
            cv[2] = v.z;
            gl.uniform3f(ud[name].location, v.x, v.y, v.z);
        }
        `,
    ubo: `
        v = uv[name];
        data[offset] = v.x;
        data[offset + 1] = v.y;
        data[offset + 2] = v.z;
    `,
  });

  uniformParsers.push({
    type: 'vec3<f32>',
    test: (data: UniformData) =>
      data.type === 'vec3<f32>' &&
      (data.value as { r?: number }).r !== undefined &&
      (data.value as { g?: number }).g !== undefined &&
      (data.value as { b?: number }).b !== undefined,
    uniform: `
        cv = ud[name].value;
        v = uv[name];

        if(cv[0] !== v.r || cv[1] !== v.g || cv[2] !== v.b)
        {
            cv[0] = v.r;
            cv[1] = v.g;
            cv[2] = v.b;
            gl.uniform3f(ud[name].location, v.r, v.g, v.b);
        }
        `,
    ubo: `
        v = uv[name];
        data[offset] = v.r;
        data[offset + 1] = v.g;
        data[offset + 2] = v.b;
    `,
  });
}
