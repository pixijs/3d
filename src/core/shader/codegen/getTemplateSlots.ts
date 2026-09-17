const findSlotsRx = /\{\{(.*?)\}\}/g;

/**
 * Extracts slot names from a template string (e.g., `{{header}}` → "header")
 * @param programSrc - The shader template containing slot placeholders
 * @returns Record with one empty array per slot name found
 */
function getTemplateSlots(programSrc: string): Record<string, string[]> {
  const slots: Record<string, string[]> = {};

  const slotMatches = programSrc.match(findSlotsRx)?.map((slot) => slot.replace(/[{()}]/g, '')) ?? [];

  slotMatches.forEach((slot) => {
    slots[slot] = [];
  });

  return slots;
}

const templateSlotCache = new Map<string, Set<string>>();

/**
 * Returns a cached set of slot names found in the given template source
 *
 * Avoids re-parsing the same template string on every plugin invocation.
 * @param templateSource - The shader template containing slot placeholders
 * @returns Set of slot names found in the template
 * @internal
 */
export function getCachedTemplateSlots(templateSource: string): Set<string> {
  let slots = templateSlotCache.get(templateSource);
  if (!slots) {
    slots = new Set(Object.keys(getTemplateSlots(templateSource)));
    templateSlotCache.set(templateSource, slots);
  }
  return slots;
}
