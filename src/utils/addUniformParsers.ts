import type { UniformData } from 'pixi.js';
import { uniformParsers } from 'pixi.js';

/**
 * Teaches pixi.js to upload pixi-3d math objects as uniforms: a `Matrix4` or `Matrix3` (anything
 * with a 16- or 9-float `elements`), and for a `vec3<f32>` any `{x,y,z}` or `{r,g,b}` object
 *
 * Called once at package import.
 *
 * `uniform` and `ubo` are source fragments. pixi.js pastes them into the upload function it
 * generates for a uniform group, which is where names like `uv`, `ud`, `data` and `offset` come
 * from. The `Matrix3` buffer write skips every fourth float because a uniform buffer pads each
 * column of a `mat3x3<f32>` to four floats.
 *
 * pixi.js uses the first parser whose `test` passes, so a narrower test must be registered before
 * a broader one. Its built-in parsers sit ahead of these and win any value both would accept. The
 * uniform-buffer path runs `test` without comparing `type`, which is why the `vec3<f32>` tests
 * check the type themselves.
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
