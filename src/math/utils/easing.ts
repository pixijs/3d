/**
 * Eases from 0 to 1 as `x` moves from `min` to `max`, starting and ending gently
 * @see https://en.wikipedia.org/wiki/Smoothstep
 * @example
 * ```ts
 * label.alpha = 1 - smoothstep(label.position.distanceTo(camera.position), 40, 60);
 * ```
 * @param x - The input value
 * @param min - The lower edge; inputs at or below it return 0
 * @param max - The upper edge; inputs at or above it return 1
 * @returns The eased value in `[0, 1]`
 * @category maths
 * @standard
 */
export function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;

  x = (x - min) / (max - min);

  return x * x * (3 - 2 * x);
}

/**
 * Like {@link smoothstep}, but its rate of change also eases in and out, so motion driven by it
 * starts and stops without a jolt
 * @see https://en.wikipedia.org/wiki/Smoothstep#Variations
 * @example
 * ```ts
 * door.rotation.y = smootherstep(elapsed, 0, 1.5) * openAngle;
 * ```
 * @param x - The input value
 * @param min - The lower edge; inputs at or below it return 0
 * @param max - The upper edge; inputs at or above it return 1
 * @returns The eased value in `[0, 1]`
 * @category maths
 * @standard
 */
export function smootherstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;

  x = (x - min) / (max - min);

  return x * x * x * (x * (x * 6 - 15) + 10);
}
