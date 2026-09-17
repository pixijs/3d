import { Texture } from 'pixi.js';

/**
 * Canvas-drawn particle art, so the particle scenes carry no binary assets and
 * every reference image is reproducible from source.
 */

/** A soft round puff — the standard smoke / glow sprite. */
export function puffTexture(size = 64): Texture {
  const canvas = document.createElement('canvas');

  canvas.width = canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);

  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.65)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}

/**
 * A wedge pointing along +V, so a quad's orientation is readable at a glance —
 * which is the whole point of a billboard-mode reference image.
 */
export function wedgeTexture(size = 64): Texture {
  const canvas = document.createElement('canvas');

  canvas.width = canvas.height = size;

  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.08);
  ctx.lineTo(size * 0.92, size * 0.92);
  ctx.lineTo(size * 0.5, size * 0.7);
  ctx.lineTo(size * 0.08, size * 0.92);
  ctx.closePath();
  ctx.fill();

  return Texture.from(canvas);
}

/**
 * A sheet of `count` frames, `columns` to a row, left to right then top to
 * bottom, each a ring that grows and thins: unmistakable when a flipbook
 * advances, and unmistakable when it doesn't.
 */
export function ringSheetTexture(count = 4, cell = 64, columns = count): Texture[] {
  const rows = Math.ceil(count / columns);
  const canvas = document.createElement('canvas');

  canvas.width = cell * columns;
  canvas.height = cell * rows;

  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const cx = (i % columns) * cell + cell / 2;
    const cy = Math.floor(i / columns) * cell + cell / 2;

    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineWidth = cell * (0.22 - t * 0.16);
    ctx.beginPath();
    ctx.arc(cx, cy, cell * (0.12 + t * 0.3), 0, Math.PI * 2);
    ctx.stroke();
  }

  const source = Texture.from(canvas).source;

  return Array.from(
    { length: count },
    (_, i) =>
      new Texture({
        source,
        frame: { x: (i % columns) * cell, y: Math.floor(i / columns) * cell, width: cell, height: cell } as never,
      }),
  );
}
