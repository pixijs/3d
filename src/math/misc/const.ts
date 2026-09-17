/**
 * String identifiers for the built-in 3D shape primitives
 *
 * Used as the `type` discriminator on shape classes to avoid `instanceof` checks in hot paths.
 * @category maths
 * @advanced
 */
export type SHAPE_PRIMITIVE_3D = 'box' | 'sphere' | 'plane' | 'ray' | 'spherical' | 'cylindrical';
