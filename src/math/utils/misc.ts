import type { TypedArray, ArrayFixed } from 'pixi.js';

/**
 * A typed array with a fixed length
 * @example
 * ```ts
 * const elements = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) as TypedFixedArray<9>;
 * ```
 * @category maths
 * @advanced
 */
export type TypedFixedArray<L extends number> = ArrayFixed<number, L> & TypedArray;
