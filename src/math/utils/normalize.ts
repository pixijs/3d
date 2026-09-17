import type { TypedArray } from 'pixi.js';

/**
 * Normalizes a float to the integer range of the given typed array constructor
 *
 * Floats in `[0, 1]` (`[-1, 1]` for signed types) map to the symmetric integer range (snorm convention for signed types). Float arrays are
 * returned unchanged.
 * @param value - The float value to normalize
 * @param array - The typed array whose component type determines the integer range
 * @returns The normalized integer value
 * @category maths
 * @advanced
 */
export function normalize(value: number, array: TypedArray): number {
  switch (array.constructor) {
    case Float32Array:
      return value;
    case Uint32Array:
      return Math.round(value * 4294967295.0);
    case Uint16Array:
      return Math.round(value * 65535.0);
    case Uint8Array:
      return Math.round(value * 255.0);
    case Int32Array:
      return Math.round(value * 2147483647.0);
    case Int16Array:
      return Math.round(value * 32767.0);
    case Int8Array:
      return Math.round(value * 127.0);
    default:
      throw new Error('Invalid component type.');
  }
}

/**
 * Denormalizes an integer value of the given typed array to a float
 *
 * Integers map to `[0, 1]` (`[-1, 1]` for signed types). Float arrays are returned unchanged.
 * @param value - The integer value to denormalize
 * @param array - The typed array whose component type determines the integer range
 * @returns The denormalized float value
 * @category maths
 * @advanced
 */
export function denormalize(value: number, array: TypedArray): number {
  switch (array.constructor) {
    case Float32Array:
      return value;
    case Uint32Array:
      return value / 4294967295.0;
    case Uint16Array:
      return value / 65535.0;
    case Uint8Array:
      return value / 255.0;
    case Int32Array:
      return Math.max(value / 2147483647.0, -1.0);
    case Int16Array:
      return Math.max(value / 32767.0, -1.0);
    case Int8Array:
      return Math.max(value / 127.0, -1.0);
    default:
      throw new Error('Invalid component type.');
  }
}
