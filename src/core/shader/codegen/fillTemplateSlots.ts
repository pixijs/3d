const SLOT_PATTERN = /\{\{(.*?)\}\}/g;

/**
 * Hard cap on substitution passes
 *
 * The natural depth today is 2 (a slot whose value contains a marker resolved by a sibling slot —
 * e.g. lobe markers nested inside a host lighting bit's body). Anything higher implies a cycle
 * (`{{x}}` whose value contains `{{x}}` again, or A↔B). The cap guarantees termination; markers
 * that survive a true cycle are caught after the loop.
 */
const MAX_PASSES = 8;

/**
 * Fills template slots with collected code
 *
 * All `{{slotName}}` placeholders are replaced — with code if provided, or empty string if not.
 *
 * Substitution iterates until the result is stable (one pass produces no change) or `MAX_PASSES`
 * is reached. This lets one slot's value contain markers for other slots, which is how a sibling
 * bit's `gpu.fragment.lobePerLight` (etc.) snippets splice into a host lighting bit's
 * already-templated light loop without spawning a second loop — see `clearcoatBit` for an example.
 * @example
 * ```ts
 * const template = "{{header}}\nvoid main() {\n  {{body}}\n}";
 * const slotCode = {
 *   header: ["uniform float uTime;"],
 *   body: ["gl_Position = vec4(0.0);"],
 * };
 * fillTemplateSlots(template, slotCode);
 * // "uniform float uTime;\nvoid main() {\n  gl_Position = vec4(0.0);\n}"
 * ```
 * @example Nested markers (lobe composition):
 * ```ts
 * const template = "void main() { {{fragmentLighting}} }";
 * const slotCode = {
 *   fragmentLighting: ["for (i in 0..N) { {{lobePerLight}} }"],
 *   lobePerLight: ["clearcoat += foo();"],
 * };
 * fillTemplateSlots(template, slotCode);
 * // "void main() { for (i in 0..N) { clearcoat += foo(); } }"
 * ```
 * @param templateSource - The template string containing `{{slotName}}` placeholders
 * @param slotCode - Record mapping slot names to arrays of code strings
 * @returns The template with all slots replaced. Throws if markers survive `MAX_PASSES`
 *   substitution passes (a cyclic slot value): silently stripping them would ship a shader
 *   missing the cyclic code.
 * @internal
 */
export function fillTemplateSlots(templateSource: string, slotCode: Record<string, string[]>): string {
  let result = templateSource;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = result.replace(SLOT_PATTERN, (_match, slotName: string) => {
      const code = slotCode[slotName];
      return code ? code.join('\n') : '';
    });
    if (next === result) break;
    result = next;
  }

  // A marker can only survive the loop if a slot's value keeps reintroducing
  // it — a cycle (`{{x}}` producing `{{x}}`, or A↔B). Stripping it would
  // compile a shader silently missing that code; fail loudly instead.
  const survivors = result.match(SLOT_PATTERN);
  if (survivors) {
    const names = [...new Set(survivors)].join(', ');
    throw new Error(
      `[fillTemplateSlots] Slot markers still present after ${MAX_PASSES} substitution passes: ${names}. ` +
        `A slot's code reintroduces its own marker (directly or via another slot) — break the cycle.`,
    );
  }

  return result;
}
