import { CanvasSource, Texture } from 'pixi.js';

/**
 * A 2x2 texture of one colour
 * @param color - Any CSS colour
 * @returns A texture of its own, on a source of its own
 */
export function solidTexture(color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 2, 2);

  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}
