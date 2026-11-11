/**
 * Lines, rects, ellipses, arrows and dots in screen pixels, for every 2D mark that isn't text: a view's outline, a
 * dashed frame, a 2D arrow, a ring round a projected point
 */

import { Container, Sprite, Texture } from 'pixi.js';

import type { HelperColor } from './helpers';
import { DISC_RADIUS, helperColorAt, MARK_SIZE, releaseMarkTextures, useMarkTextures } from './overlay';
import type { MarkTextures, ThemeSource } from './overlay';

export interface ScreenLinesOptions {
  /** Where the themed colours, `'ink'` and `'haze'`, read the theme from */
  stage: ThemeSource;
  /** The colour {@link ScreenLines#clear} returns to, like the rest of these. @default 'ink' */
  color?: HelperColor;
  /** The line width, in px. @default 1.5 */
  width?: number;
  /** @default 1 */ alpha?: number;
  /** A dash's length in px; 0 draws solid lines. @default 0 */
  dash?: number;
  /** The space between dashes, in px. @default the dash length */
  gap?: number;
}

/** An arrow head's width over its length */
const HEAD_ASPECT = 0.85;
/** Arrow heads shorter than this, in px, are dropped, leaving a plain line */
const MIN_HEAD = 3;

/** Whether point `i` of an x, y list is there: in range and not a NaN pen lift */
function isPoint(xy: ArrayLike<number>, count: number, i: number): boolean {
  return i >= 0 && i < count && !Number.isNaN(xy[i * 2]) && !Number.isNaN(xy[i * 2 + 1]);
}

/** Points for ellipses and rounded rects, grown to the largest shape drawn */
let _path = new Float32Array(192);

/**
 * Lines, rects, ellipses, arrows and dots in screen pixels, in the theme's helper colours
 *
 * Every piece is a pooled sprite: a white one turned along a segment and scaled to its length by the line's width, or
 * a cached disc or triangle for a dot or an arrow head, so the pieces batch with the labels and panels. Coordinates are
 * the container's own: global px when it sits on `app.stage` at the origin. Call {@link ScreenLines#clear}, then draw
 * each shape in the style set before it, when something moves or every frame; neither allocates once the pool has
 * grown. Call {@link ScreenLines#update} each frame so `'ink'` and `'haze'` pieces follow the theme.
 * @example
 * ```ts
 * const marks = new ScreenLines({ stage, color: 'ink', width: 1.5 });
 * app.stage.addChild(view3d, marks, labels);
 * marks.clear().style('accent', 2, 1, 6, 4).rect(x, y, w, h, 8).style('ink').arrow(x0, y0, x1, y1);
 * marks.update();
 * ```
 */
export class ScreenLines extends Container {
  private readonly _stage: ThemeSource;
  private readonly _marks: MarkTextures = useMarkTextures();
  private readonly _pieces: Sprite[] = [];
  private readonly _colors: HelperColor[] = [];
  private readonly _base: Required<Omit<ScreenLinesOptions, 'stage'>>;
  private _used = 0;
  private _darkness = -1;
  private _color: HelperColor = 'ink';
  private _width = 1.5;
  private _alpha = 1;
  private _dash = 0;
  private _gap = 0;
  /** How far into the dash pattern the current shape has run, in px */
  private _phase = 0;

  constructor({ stage, color = 'ink', width = 1.5, alpha = 1, dash = 0, gap = dash }: ScreenLinesOptions) {
    super({ eventMode: 'none' });
    this._stage = stage;
    this._darkness = stage.darkness;
    this._base = { color, width, alpha, dash, gap };
    this.style(color, width, alpha, dash, gap);
  }

  /** Sets the style for the shapes that follow; dashes run along each shape's length */
  public style(color: HelperColor, width = 1.5, alpha = 1, dash = 0, gap = dash): this {
    this._color = color;
    this._width = width;
    this._alpha = alpha;
    this._dash = gap > 0 ? dash : 0;
    this._gap = gap;

    return this;
  }

  /** Hides every piece and returns to the style given at construction; call it before a redraw */
  public clear(): this {
    for (let i = 0; i < this._used; i++) this._pieces[i].visible = false;
    this._used = 0;

    const { color, width, alpha, dash, gap } = this._base;

    return this.style(color, width, alpha, dash, gap);
  }

  /** A straight line between two points */
  public line(x0: number, y0: number, x1: number, y1: number): this {
    this._phase = 0;

    return this._segment(x0, y0, x1, y1, 0, 0);
  }

  /** A line through the first `count` x, y pairs of `xy`, back to the first when `closed`; a NaN lifts the pen */
  public polyline(xy: ArrayLike<number>, count = xy.length / 2, closed = false): this {
    // Opaque solid lines run half their width past each joint so corners close; see-through ones would darken there.
    const join = this._dash === 0 && this._alpha >= 1 ? this._width / 2 : 0;

    this._phase = 0;
    for (let i = 0; i < (closed ? count : count - 1); i++) {
      const j = (i + 1) % count;
      const before = isPoint(xy, count, closed ? (i - 1 + count) % count : i - 1) ? join : 0;
      const after = isPoint(xy, count, closed ? (j + 1) % count : j + 1) ? join : 0;

      if (isPoint(xy, count, i) && isPoint(xy, count, j)) {
        this._segment(xy[i * 2], xy[i * 2 + 1], xy[j * 2], xy[j * 2 + 1], before, after);
      }
    }

    return this;
  }

  /** A rect's outline, with corners rounded to `radius` */
  public rect(x: number, y: number, width: number, height: number, radius = 0): this {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    // Each corner's arc, clockwise from the top right; a square corner is a single point.
    const steps = r > 0 ? Math.max(2, Math.ceil(r / 2)) : 0;
    const count = (steps + 1) * 4;

    if (_path.length < count * 2) _path = new Float32Array(count * 2);
    for (let k = 0; k < count; k++) {
      const corner = Math.floor(k / (steps + 1));
      const angle = (corner - 1 + (steps > 0 ? (k % (steps + 1)) / steps : 0)) * (Math.PI / 2);

      _path[k * 2] = (corner < 2 ? x + width - r : x + r) + Math.cos(angle) * r;
      _path[k * 2 + 1] = (corner === 0 || corner === 3 ? y + r : y + height - r) + Math.sin(angle) * r;
    }

    return this.polyline(_path, count, true);
  }

  /** A filled rect in the current colour and alpha */
  public fillRect(x: number, y: number, width: number, height: number): this {
    return this._piece(Texture.WHITE, 0, x, y + height / 2, 0, width, height);
  }

  /** An ellipse's outline round `(cx, cy)`, through `segments` points */
  public ellipse(cx: number, cy: number, rx: number, ry: number, segments = 48): this {
    if (_path.length < segments * 2) _path = new Float32Array(segments * 2);
    for (let i = 0; i < segments; i++) {
      _path[i * 2] = cx + Math.cos((i / segments) * Math.PI * 2) * rx;
      _path[i * 2 + 1] = cy + Math.sin((i / segments) * Math.PI * 2) * ry;
    }

    return this.polyline(_path, segments, true);
  }

  /** An arrow to a tip at `(x1, y1)`, its head `head` px long, shrinking on a short arrow and dropped under 3 px */
  public arrow(x0: number, y0: number, x1: number, y1: number, head = 8): this {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const size = Math.min(head, length / 2);
    // The shaft stops inside the head, so its square end never shows past the head's sides.
    const shaft = 1 - (size * 0.6) / length;
    const width = Math.max(size * HEAD_ASPECT, this._width * 3);

    if (size < MIN_HEAD) return this.line(x0, y0, x1, y1);
    this.line(x0, y0, x0 + (x1 - x0) * shaft, y0 + (y1 - y0) * shaft);

    return this._piece(this._marks.head, 1, x1, y1, Math.atan2(y1 - y0, x1 - x0), size / MARK_SIZE, width / MARK_SIZE);
  }

  /** A filled dot, or with `hollow` a ring in the current line width and dash */
  public dot(x: number, y: number, radius: number, hollow = false): this {
    if (hollow) return this.ellipse(x, y, radius, radius, Math.min(48, Math.max(12, Math.round(radius * 1.5))));

    return this._piece(this._marks.disc, 0.5, x, y, 0, radius / DISC_RADIUS, radius / DISC_RADIUS);
  }

  /** Re-tints the pieces drawn in `'ink'` or `'haze'` when the stage's darkness changes; call it each frame */
  public update(): void {
    if (this._stage.darkness === this._darkness) return;
    this._darkness = this._stage.darkness;
    for (let i = 0; i < this._used; i++) {
      const color = this._colors[i];

      if (color === 'ink' || color === 'haze') this._pieces[i].tint = helperColorAt(color, this._darkness);
    }
  }

  /** Frees its sprites; the last ScreenLines to go frees the cached disc and triangle */
  public override destroy(): void {
    if (this.destroyed) return;
    this._pieces.length = 0;
    super.destroy({ children: true });
    (this._marks as MarkTextures | null) = null;
    releaseMarkTextures();
  }

  /** One straight stroke, dashed in the current style, run `before` and `after` px past its ends */
  private _segment(x0: number, y0: number, x1: number, y1: number, before: number, after: number): this {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    const angle = Math.atan2(uy, ux);
    const period = this._dash + this._gap;
    const span = length + before + after;

    if (!(length > 1e-6)) return this;
    if (this._dash === 0)
      return this._piece(Texture.WHITE, 0, x0 - ux * before, y0 - uy * before, angle, span, this._width);
    for (let t = 0; t < length;) {
      const on = this._phase < this._dash;
      const run = Math.min((on ? this._dash : period) - this._phase, length - t);

      if (on) this._piece(Texture.WHITE, 0, x0 + ux * t, y0 + uy * t, angle, run, this._width);
      t += run;
      this._phase += run;
      if (this._phase >= period) this._phase -= period;
    }

    return this;
  }

  /**
   * Shows the next pooled sprite in the current style, anchored `anchorX` along it and at its middle across; the pool
   * grows only when a redraw needs more
   */
  private _piece(texture: Texture, anchorX: number, x: number, y: number, angle: number, sx: number, sy: number): this {
    let piece = this._pieces[this._used];

    if (!piece) {
      piece = this.addChild(new Sprite(texture));
      this._pieces.push(piece);
    }
    piece.texture = texture;
    piece.anchor.set(anchorX, 0.5);
    piece.position.set(x, y);
    piece.rotation = angle;
    piece.scale.set(sx, sy);
    piece.visible = true;
    piece.tint = helperColorAt(this._color, this._darkness);
    piece.alpha = this._alpha;
    this._colors[this._used++] = this._color;

    return this;
  }
}
