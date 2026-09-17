/**
 * Returns a random color
 * @param random - The random function to use, defaults to `Math.random`
 * @returns A random color as a `0xRRGGBB` integer
 * @category maths
 * @standard
 */
export function randomColor(random = Math.random) {
  const r = Math.floor(0xff * random());
  const g = Math.floor(0xff * random());
  const b = Math.floor(0xff * random());

  return (r << 16) | (g << 8) | b;
}

/**
 * Returns a random number within a range
 * @param min - The lowest number (inclusive)
 * @param max - The highest number (exclusive)
 * @param floor - Whether the number should be floored
 * @param random - The random function to use, defaults to `Math.random`
 * @returns A random number in `[min, max)`
 * @category maths
 * @standard
 */
export function randomRange(min: number, max: number, floor = false, random = Math.random) {
  const v = min + (max - min) * random();

  return floor ? Math.floor(v) : v;
}

/**
 * Returns a random value from an object
 * @param obj - The object to select from
 * @param random - The random function to use, defaults to `Math.random`
 * @returns The value of a randomly chosen key
 * @category maths
 * @standard
 */
export function randomObjItem<T extends Record<string, unknown>>(obj: T, random = Math.random): T[keyof T] {
  const keys = Object.keys(obj) as (keyof T)[];
  const key = keys[Math.floor(random() * keys.length)];

  return obj[key as keyof T];
}

/**
 * Returns a random item from an array
 * @param arr - The array to select from
 * @param random - The random function to use, defaults to `Math.random`
 * @returns A randomly chosen element
 * @category maths
 * @standard
 */
export function randomItem<T>(arr: T[], random = Math.random) {
  return arr[Math.floor(random() * arr.length)];
}

/**
 * Returns a random number within a range
 * @param min - The minimum value (inclusive)
 * @param max - The maximum value (exclusive)
 * @param random - The random function to use, defaults to `Math.random`
 * @returns A random number in `[min, max)`
 * @category maths
 * @standard
 */
export function randomFloat(min: number, max: number, random = Math.random) {
  return random() * (max - min) + min;
}

/**
 * Returns a random float in the interval `[-range/2, range/2]`
 * @param range - The total spread
 * @param random - The random function to use, defaults to `Math.random`
 * @returns A random number centered on zero
 * @category maths
 * @standard
 */
export function randomSpread(range: number, random = Math.random) {
  return range * (0.5 - random());
}

/**
 * Returns a random integer within a range
 * @param min - The minimum value (inclusive)
 * @param max - The maximum value (inclusive)
 * @param random - The random function to use, defaults to `Math.random`
 * @returns A random integer in `[min, max]`
 * @category maths
 * @standard
 */
export function randomInt(min: number, max: number, random = Math.random) {
  return Math.floor(random() * (max - min + 1)) + min;
}

/**
 * Returns a random boolean
 * @param weight - The chance of a `true` value, between 0 and 1
 * @param random - The random function to use, defaults to `Math.random`
 * @returns `true` with probability `weight`
 * @category maths
 * @standard
 */
export function randomBool(weight = 0.5, random = Math.random) {
  return random() < weight;
}

/**
 * Returns -1 or 1 at random
 * @param random - The random function to use, defaults to `Math.random`
 * @returns Either `-1` or `1`
 * @category maths
 * @standard
 */
export function randomSign(random = Math.random) {
  return randomInt(0, 1, random) * 2 - 1;
}

/**
 * Randomly shuffles an array in place, without cloning it
 * @param array - The array that will be shuffled
 * @param random - The random function to use, defaults to `Math.random`
 * @returns The same array, shuffled
 * @category maths
 * @standard
 */
export function randomShuffle<T>(array: T[], random = Math.random): T[] {
  let currentIndex = array.length;
  let temporaryValue;
  let randomIndex;

  while (currentIndex !== 0) {
    randomIndex = Math.floor(random() * currentIndex);
    currentIndex -= 1;
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

/**
 * Returns a random string hash, not guaranteed to be unique
 * @param length - The length of the hash
 * @param random - The random function to use, defaults to `Math.random`
 * @returns A random alphanumeric string
 * @category maths
 * @standard
 */
export function randomHash(length: number, random = Math.random): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let result = '';

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(random() * charactersLength));
  }

  return result;
}

/**
 * Returns a random item from a list of `[odds, item]` pairs, weighted by each item's odds
 * @example
 * ```ts
 * const item = randomOdds([
 *   [3, item1],
 *   [5, item2],
 *   [2, item3],
 * ]);
 * ```
 * @param odds - An array of `[odds, item]` pairs
 * @param random - The random function to use, defaults to `Math.random`
 * @returns One of the passed items
 * @category maths
 * @standard
 */
export function randomOdds<T>(odds: [number, T][], random = Math.random): T {
  if (!odds.length) throw new Error('[Random] Odds list provided is empty');

  if (odds.length === 1) return odds[0][1];

  odds = odds.slice(0).sort((a, b) => a[0] - b[0]);

  const amount = odds.reduce((prev, curr) => prev + curr[0], 0);

  /**
   * Accumulated ranges — an item wins when the roll lands in `[min, max)`
   * @internal
   */
  const oddsMap: { min: number; max: number; val: T }[] = [];
  let accumulated = 0;

  for (const odd of odds) {
    oddsMap.push({
      min: accumulated,
      max: accumulated + odd[0],
      val: odd[1],
    });

    accumulated += odd[0];
  }

  const rand = random() * amount;

  for (const odd of oddsMap) {
    if (rand >= odd.min && rand < odd.max) return odd.val;
  }

  throw new Error('[Random] Something has gone wrong with the odds provided');
}
