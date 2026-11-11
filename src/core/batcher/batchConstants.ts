/**
 * Most direct commands a run of one pipeline, texture set and geometry records on WebGPU before it
 * merges; lower values cost frame time in distance-sorted passes (`bench/transparency.bench.ts`)
 * @internal
 */
export const MERGE_THRESHOLD = 16;
