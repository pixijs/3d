/**
 * Smooth Hermite interpolation in `[0, 1]` between `min` and `max`
 * @see https://en.wikipedia.org/wiki/Smoothstep
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
 * Variation on smoothstep with zero 1st and 2nd order derivatives at `x=0` and `x=1`
 * @see https://en.wikipedia.org/wiki/Smoothstep#Variations
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
