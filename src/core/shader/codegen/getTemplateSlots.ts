const findSlotsRx = /\{\{(.*?)\}\}/g;

function getTemplateSlots(programSrc: string): Record<string, string[]> {
  const slots: Record<string, string[]> = {};

  const slotMatches = programSrc.match(findSlotsRx)?.map((slot) => slot.replace(/[{()}]/g, '')) ?? [];

  slotMatches.forEach((slot) => {
    slots[slot] = [];
  });

  return slots;
}

const templateSlotCache = new Map<string, Set<string>>();

/** @internal */
export function getCachedTemplateSlots(templateSource: string): Set<string> {
  let slots = templateSlotCache.get(templateSource);
  if (!slots) {
    slots = new Set(Object.keys(getTemplateSlots(templateSource)));
    templateSlotCache.set(templateSource, slots);
  }
  return slots;
}
