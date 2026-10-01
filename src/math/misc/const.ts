/**
 * Names of the built-in 3D shapes, as found on each shape's `type` field
 *
 * Reading `type` costs less than an `instanceof` test, as with pixi's `SHAPE_PRIMITIVE`.
 * @category maths
 * @advanced
 */
export type SHAPE_PRIMITIVE_3D = 'box' | 'sphere' | 'plane' | 'ray' | 'spherical' | 'cylindrical';
