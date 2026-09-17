import type { UniformData } from 'pixi.js';
import { uniformParsers } from 'pixi.js';

/**
 * Registers pixi-3d's uniform parsers with pixi.js — `Matrix4` / `Matrix3`
 * (16- / 9-element `elements`), `{x,y,z}` vectors, and `{r,g,b}` colors
 *
 * Called once at package import.
 *
 * Parser order matters: a uniform value is treated as the first parser whose
 * test it passes (including pixi's built-in parsers), so more specific tests
 * must be registered ahead of broader ones.
 * @internal
 */
export function addUniformParsers(): void {
  uniformParsers.push({
    type: 'mat4x4<f32>',
    test: (data: UniformData) => (data.value as any).elements?.length === 16,
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
    test: (data: UniformData) => (data.value as any).elements?.length === 9,
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
    test: (data: UniformData) => data.type === 'vec3<f32>' && data.size === 1 && (data.value as any).x !== undefined,
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
      (data.value as any).r !== undefined &&
      (data.value as any).g !== undefined &&
      (data.value as any).b !== undefined,
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
