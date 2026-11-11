/** One tile of the asset shelf: a card holding a geometry's picture, or why it has none, over its name and triangles */

import type { Geometry3D } from '@pixi/3d';
import { BitmapText, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { PointData } from 'pixi.js';

import { LABEL_FONT, overlayColor } from '../shared/theme/overlay';

/** The space round the picture inside the card, and between the picture and the captions */
export const TILE_PAD = 6;
const CAPTION_GAP = 4;
const CARD_RADIUS = 6;
/** A card is ink at 8% over the panel, as the pane's rows are */
const CARD_ALPHA = 0.08;

/** A tile's sizes: its picture's side and its texts' font sizes, all in px */
export interface TileSize {
  slot: number;
  name: number;
  info: number;
  /** The placeholder's, which fits `too-many-` across the picture */
  reason: number;
}

/** A tile's width and height for `size`, its card's padding included */
export function tileExtent({ slot, name, info }: TileSize): { width: number; height: number } {
  return { width: slot + TILE_PAD * 2, height: TILE_PAD + slot + CAPTION_GAP + name + CAPTION_GAP + info + TILE_PAD };
}

/** A tile: `arrange` sizes it for the shelf's layout, and `paint` follows the theme */
export class ShelfTile extends Container {
  private readonly _card = new Graphics();
  private readonly _picture = new Sprite({ texture: Texture.EMPTY, visible: false });
  private readonly _name = label();
  private readonly _tris = label();
  private readonly _reason = label({ x: 0.5, y: 0.5 });
  private _slot = 0;

  constructor() {
    super();
    this.addChild(this._card, this._picture, this._name, this._tris, this._reason);
  }

  /** Whether it shows a picture rather than a reason */
  get hasPicture(): boolean {
    return this._picture.visible;
  }

  /** Captions it with `name` and `geometry`'s triangle count, which the generator's limit is about */
  public caption(name: string, geometry: Geometry3D): void {
    this._name.text = name;
    this._tris.text = `${(geometry.indices.length / 3).toLocaleString('en-US')} tris`;
  }

  /** Shows `texture`, stretched to fill the picture's square */
  public showTexture(texture: Texture): void {
    this._picture.texture = texture;
    this._picture.setSize(this._slot);
    this._picture.visible = true;
    this._reason.text = '';
  }

  /** Shows why it has no picture, its last word on a line of its own so `too-many-triangles` fits a small tile */
  public showReason(reason: string): void {
    this._picture.texture = Texture.EMPTY;
    this._picture.visible = false;
    this._reason.text = reason.replace(/-(?=[^-]*$)/, '-\n');
  }

  /** Lays the card, picture and captions out for `size` */
  public arrange(size: TileSize): void {
    const { slot, name, info, reason } = size;
    const { width, height } = tileExtent(size);
    const captionY = TILE_PAD + slot + CAPTION_GAP;

    this._slot = slot;
    this._card.clear().roundRect(0, 0, width, height, CARD_RADIUS).fill({ color: 0xffffff, alpha: CARD_ALPHA });
    this._picture.position.set(TILE_PAD, TILE_PAD);
    this._picture.setSize(slot);
    this._name.style.fontSize = name;
    this._name.position.set(TILE_PAD, captionY);
    this._tris.style.fontSize = info;
    this._tris.position.set(TILE_PAD, captionY + name + CAPTION_GAP);
    this._reason.style.fontSize = reason;
    this._reason.position.set(TILE_PAD + slot / 2, TILE_PAD + slot / 2);
  }

  /** Paints the card and text for a darkness, 0 light to 1 dark */
  public paint(darkness: number): void {
    this._card.tint = this._name.tint = overlayColor('ink', darkness);
    this._tris.tint = this._reason.tint = overlayColor('inkSoft', darkness);
  }
}

function label(anchor: PointData = { x: 0, y: 0 }): BitmapText {
  return new BitmapText({ text: '', style: { fontFamily: LABEL_FONT, fontSize: 11, align: 'center' }, anchor });
}
