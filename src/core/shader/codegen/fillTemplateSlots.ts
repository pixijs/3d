const SLOT_PATTERN = /\{\{(.*?)\}\}/g;

/** Two passes suffice today, the second for markers inside slot code; more than eight is a cycle */
const MAX_PASSES = 8;

/**
 * Throws on markers left after `MAX_PASSES`, rather than strip them and compile a shader missing that code
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
