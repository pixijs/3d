import { describe, expect, it } from 'vitest';

import { compileShader } from '~/core/shader/compileShader';
import type { ShaderCompilerPlugin } from '~/core/shader/ShaderCompilerPlugin';

describe('compileShader', () => {
  it('should replace template slots using a plugin', () => {
    const templateString = `
    {{header}}
    void main() {
      {{body}}
    }
    `;

    const context = {
      bits: [],
      template: { bindGroups: [] },
      templateString,
      data: {},
    };

    const plugin: ShaderCompilerPlugin = {
      injectCode() {
        return {
          header: 'uniform float uTime;',
          body: 'gl_Position = vec4(0.0);',
        };
      },
    };

    const result = compileShader(context, [plugin]);

    expect(result).toContain('uniform float uTime;');
    expect(result).toContain('gl_Position = vec4(0.0);');
    expect(result).not.toContain('{{header}}');
    expect(result).not.toContain('{{body}}');
  });

  it('should ignore empty string injections', () => {
    const templateString = `{{header}}`;

    const context = {
      bits: [],
      template: { bindGroups: [] },
      templateString,
      data: {},
    };

    const plugin: ShaderCompilerPlugin = {
      injectCode() {
        return {
          header: '',
        };
      },
    };

    const result = compileShader(context, [plugin]);

    expect(result.trim()).toBe('');
  });

  it('should accumulate code from multiple plugins', () => {
    const templateString = `{{header}}`;

    const context = {
      bits: [],
      template: { bindGroups: [] },
      templateString,
      data: {},
    };

    const pluginA: ShaderCompilerPlugin = {
      injectCode() {
        return { header: 'var A: f32;' };
      },
    };

    const pluginB: ShaderCompilerPlugin = {
      injectCode() {
        return { header: 'var B: f32;' };
      },
    };

    const result = compileShader(context, [pluginA, pluginB]);

    expect(result).toContain('var A: f32;');
    expect(result).toContain('var B: f32;');
  });

  it('should allow sharing data via context.data across phases', () => {
    const templateString = `{{header}}`;

    const context = {
      bits: [],
      template: { bindGroups: [] },
      templateString,
      data: {} as Record<string, any>,
    };

    const collectPlugin: ShaderCompilerPlugin = {
      collectData(ctx) {
        (ctx.data as any).sharedValue = 42;
      },
    };

    const readPlugin: ShaderCompilerPlugin = {
      injectCode(ctx) {
        return { header: `let val = ${(ctx.data as any).sharedValue};` };
      },
    };

    const result = compileShader(context, [collectPlugin, readPlugin]);

    expect(result).toContain('let val = 42;');
  });
});
