import { describe, expect, it } from 'vitest';

import { fillTemplateSlots } from '~/core/shader/codegen/fillTemplateSlots';

describe('fillTemplateSlots', () => {
  it('fills a single-pass template with provided slot code', () => {
    const template = '{{header}}\nvoid main() { {{body}} }';
    const result = fillTemplateSlots(template, {
      header: ['uniform float uTime;'],
      body: ['gl_Position = vec4(0.0);'],
    });
    expect(result).toBe('uniform float uTime;\nvoid main() { gl_Position = vec4(0.0); }');
  });

  it("expands markers that one slot's value introduces, as lobe composition does", () => {
    const template = '{{outer}}';
    const result = fillTemplateSlots(template, {
      outer: ['for (i=0; i<N; i++) { {{innerLobe}} }'],
      innerLobe: ['accum += contribution(i);'],
    });
    expect(result).toBe('for (i=0; i<N; i++) { accum += contribution(i); }');
  });

  it('throws on a marker that its own value reintroduces, directly or through another slot, rather than strip it', () => {
    expect(() => fillTemplateSlots('{{self}}', { self: ['hi {{self}}'] })).toThrow(/\{\{self\}\}/);
    expect(() => fillTemplateSlots('{{a}}', { a: ['x {{b}}'], b: ['y {{a}}'] })).toThrow(/substitution passes/);
  });
});
