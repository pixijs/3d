import type { TypedArray } from 'pixi.js';

/**
 * Converts a float to the integer that stands for it in a normalized integer array, such as a
 * `Uint8Array` of vertex colours
 *
 * Unsigned types map `[0, 1]` onto `[0, max]` and signed types map `[-1, 1]` onto `[-max, max]`,
 * where `max` is the type's largest value. A `Float32Array` keeps the value as it is. Any other
 * array type, such as `Float64Array`, throws.
 * @param value - The float to convert
 * @param array - Array whose type sets the integer range; only its type is read
 * @returns The integer to store
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
 * Converts an integer read from a normalized integer array back to the float it stands for, the
 * reverse of {@link normalize}
 *
 * Signed results clamp at `-1`, since a signed type's lowest value lies one step past `-max`. A
 * `Float32Array` keeps the value as it is. Any other array type, such as `Float64Array`, throws.
 * @param value - The integer to convert
 * @param array - Array whose type sets the integer range; only its type is read
 * @returns The float, in `[0, 1]` for unsigned types and `[-1, 1]` for signed ones
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
