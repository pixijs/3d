/** An InsetView's title tag on the panel's edge, and the accent outline its light draws round the panel */

import { BitmapText, Container, Graphics } from 'pixi.js';

import { LABEL_FONT, LABEL_FONT_SIZE, overlayColor, PANEL_ALPHA, textOn } from './overlay';
import type { Corner } from './overlay';
import { BRAND, mixColor } from './palette';

/** The tag's padding round its text, and its height: a label tag's */
const TAG_PAD = 6;
const TAG_HEIGHT = LABEL_FONT_SIZE + 6;
/** Seconds a light takes to fade once its hold is over */
const FADE = 0.4;

/**
 * A small neutral tag that sits on a panel's edge at a corner, and the 2 px accent outline that lights with it
 *
 * The tag overlaps the panel by its rim and stands out past the edge by the rest, so it never covers the picture.
 * {@link InsetTitle#light} lights the tag and the outline in accent for a hold, then fades them; `focus` holds the
 * look until it's turned off.
 * @example
 * ```ts
 * const title = panel.addChild(new InsetTitle('top-left', 'side view'));
 *
 * title.layout(328, 188, 10, 4);
 * app.ticker.add((ticker) => title.update(ticker.deltaMS / 1000, 1.5));
 * ```
 */
export class InsetTitle extends Container {
  private readonly _corner: Corner;
  private readonly _outline = new Graphics({ visible: false });
  private readonly _tag = new Graphics();
  private readonly _text = new BitmapText({ style: { fontFamily: LABEL_FONT, fontSize: LABEL_FONT_SIZE } });
  /** The panel's size, corner radius and rim at the last layout */
  private readonly _panel = { width: 0, height: 0, radius: 0, rim: 0 };
  private _darkness = 0;
  /** Seconds since the light began, or -1 while it's unlit */
  private _litFor = -1;
  private _focused = false;
  private _light = 0;

  constructor(corner: Corner, text = '') {
    super({ eventMode: 'none' });
    this._corner = corner;
    this.addChild(this._outline, this._tag, this._text);
    this.text = text;
  }

  /** The tag's text; empty hides it */
  get text(): string {
    return this._text.text;
  }
  set text(value: string) {
    if (value === this._text.text) return;
    this._text.text = value;
    this._tag.clear();
    if (value) this._tag.roundRect(0, 0, this._tagWidth(), TAG_HEIGHT, TAG_HEIGHT / 2).fill(0xffffff);
    this._place();
  }

  /** Lights the tag and the outline in accent, held for the `hold` that {@link InsetTitle#update} gets, then faded */
  public light(): void {
    this._litFor = 0;
  }

  /** Holds the lit look until `focus(false)` */
  public focus(on: boolean): void {
    this._focused = on;
  }

  /** Runs the light by `dt` seconds, holding it `hold` seconds before the fade */
  public update(dt: number, hold: number): void {
    if (this._litFor >= 0) this._litFor = this._litFor + dt > hold + FADE ? -1 : this._litFor + dt;

    const light = this._focused ? 1 : this._litFor < 0 ? 0 : Math.min(1, 1 - (this._litFor - hold) / FADE);

    if (light !== this._light) {
      this._light = light;
      this.paint(this._darkness);
    }
  }

  /** Paints the tag and the outline for a darkness, 0 light to 1 dark, mixed toward accent by the light */
  public paint(darkness: number): void {
    const light = this._light;

    this._darkness = darkness;
    this._tag.tint = mixColor(overlayColor('panel', darkness), BRAND.hotPink, light);
    this._tag.alpha = PANEL_ALPHA + (1 - PANEL_ALPHA) * light;
    this._text.tint = mixColor(overlayColor('ink', darkness), textOn(BRAND.hotPink), light);
    this._outline.visible = light > 0;
    this._outline.alpha = light;
  }

  /** Lays the tag and the outline out on a panel `width` × `height` px with that corner `radius` and `rim` */
  public layout(width: number, height: number, radius: number, rim: number): void {
    Object.assign(this._panel, { width, height, radius, rim });
    this._outline.clear().roundRect(0, 0, width, height, radius).stroke({ width: 2, color: BRAND.hotPink });
    this._place();
  }

  /** Puts the tag past the corner's curve, overlapping the panel by its rim, or by half the tag on a wider rim */
  private _place(): void {
    const { width, height, radius, rim } = this._panel;
    const corner = this._corner;
    const across = corner.endsWith('left') ? 0 : corner.endsWith('right') ? 1 : 0.5;
    const overlap = Math.min(rim, TAG_HEIGHT / 2);

    this._tag.x = Math.round(radius + (width - radius * 2 - this._tagWidth()) * across);
    this._tag.y = corner.startsWith('top') ? overlap - TAG_HEIGHT : height - overlap;
    this._text.position.set(this._tag.x + TAG_PAD, this._tag.y + 3);
  }

  private _tagWidth(): number {
    return Math.ceil(this._text.width) + TAG_PAD * 2;
  }
}
