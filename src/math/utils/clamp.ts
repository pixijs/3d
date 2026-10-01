/**
 * Clamps a value between a minimum and maximum
 * @example
 * ```ts
 * player.health = clamp(player.health + pickup.amount, 0, player.maxHealth);
 * ```
 * @param value - The value to clamp
 * @param min - The lower bound
 * @param max - The upper bound
 * @returns The value restricted to `[min, max]`
 * @category maths
 * @standard
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
