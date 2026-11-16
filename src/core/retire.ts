const retired: { destroy(): void }[] = [];

function destroyRetired(): void {
  for (let i = 0; i < retired.length; i++) retired[i].destroy();
  retired.length = 0;
}

/**
 * Waits until synchronous renders, including nested renders on other renderers, have submitted their commands
 * @internal
 */
export function retire(resource: { destroy(): void }): void {
  if (retired.push(resource) === 1) queueMicrotask(destroyRetired);
}
