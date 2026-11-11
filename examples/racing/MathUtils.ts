export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}
