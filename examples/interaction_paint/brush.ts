/**
 * The brush: round strokes on a canvas's 2D context, pixel to pixel
 *
 * Plain 2D drawing with nothing 3D in it. `index.ts` turns each hit's uv into a canvas pixel and hands it here, then
 * sends the canvas to the GPU once a frame while `dirty` says something was painted.
 */

import { Point } from 'pixi.js';

import { cssColor } from '../shared/theme/palette';

/**
 * A jump between two points wider than this share of the canvas is a stroke crossing the ball's seam, where u wraps
 * from 1 to 0: a line there would streak across the whole picture, so the stroke starts again on the other side
 */
const MAX_JOIN = 0.25;

export interface BrushOptions {
  /** The canvas's 2D context it paints with */
  paint: CanvasRenderingContext2D;
  /** Paints what the canvas shows before any stroke, and again on a clear */
  primer: (paint: CanvasRenderingContext2D) => void;
  /** A dab's radius, in canvas px */
  radius: number;
  /** 0xRRGGBB */
  color: number;
}

export interface Brush {
  /** A dab's radius, in canvas px; call {@link Brush#apply} after a change */
  radius: number;
  /** The paint's colour, 0xRRGGBB; call {@link Brush#apply} after a change */
  color: number;
  /** Whether it painted since `index.ts` last reset this after an upload, so the canvas needs sending to the GPU */
  dirty: boolean;
  /** Sets the context's colour and line width from `radius` and `color` */
  apply(): void;
  /** Paints to canvas pixel (x, y): a line from the stroke's last point, or a round dab that starts one */
  strokeTo(x: number, y: number): void;
  /** Ends the stroke, so the next point starts a new one */
  lift(): void;
  /** Paints the primer over everything */
  clear(): void;
}

export function createBrush({ paint, primer, radius, color }: BrushOptions): Brush {
  const last = new Point();
  let open = false;
  const brush: Brush = {
    radius,
    color,
    dirty: false,
    apply() {
      paint.fillStyle = paint.strokeStyle = cssColor(brush.color);
      paint.lineWidth = brush.radius * 2;
    },
    strokeTo(x, y) {
      paint.beginPath();
      if (open && Math.abs(x - last.x) < paint.canvas.width * MAX_JOIN) {
        paint.moveTo(last.x, last.y);
        paint.lineTo(x, y);
        paint.stroke();
      } else {
        paint.arc(x, y, brush.radius, 0, Math.PI * 2);
        paint.fill();
      }
      last.set(x, y);
      open = true;
      brush.dirty = true;
    },
    lift() {
      open = false;
    },
    clear() {
      // Saved and restored round the primer, so the brush's own style survives it.
      paint.save();
      primer(paint);
      paint.restore();
      open = false;
      brush.dirty = true;
    },
  };

  paint.lineCap = 'round';
  primer(paint);
  brush.apply();

  return brush;
}
