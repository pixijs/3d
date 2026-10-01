const SLOT_PATTERN = /\{\{(.*?)\}\}/g;

/**
 * The most substitution passes `fillTemplateSlots` makes
 *
 * Two passes are enough today: one for the template's markers, one for markers inside slot code,
 * such as the lobe markers in a lighting bit's loop. Needing more than eight means a slot's code
 * brings its own marker back, directly or through another slot.
 */
const MAX_PASSES = 8;

/**
 * Replaces every `{{slotName}}` marker with that slot's code joined by newlines, or with nothing
 *
 * It repeats until a pass changes nothing, so a slot's code can hold markers of its own. That is
 * how a lobe bit's `fragment.lobePerLight` code lands inside the light loop a lighting bit put in
 * the `lighting` slot.
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
 * @returns The filled source. Throws if markers survive `MAX_PASSES` passes, since stripping them
 *   would compile a shader missing that code.
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
