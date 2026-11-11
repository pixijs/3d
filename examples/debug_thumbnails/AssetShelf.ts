/**
 * The asset shelf: a 2D browser docked along the bottom of the screen, one tile per geometry, each showing the
 * picture `index.ts` hands it, or why there is none
 *
 * It's the asset browser thumbnails are made for, built on the kit's `Panel` so it follows the theme. It never makes
 * a texture: `index.ts` hands each tile its own.
 */

import type { Geometry3D, Mesh3D } from '@pixi/3d';
import type { Rectangle, Texture } from 'pixi.js';

import type { ThemeSource } from '../shared/theme/overlay';
import { Panel } from '../shared/theme/Panel';
import { ScreenLines } from '../shared/theme/ScreenLines';
import { ShelfTile, TILE_PAD, tileExtent } from './ShelfTile';
import type { TileSize } from './ShelfTile';

/** A wide screen's tiles, in one row; a narrower one's, in one row while they fit and in two rows of four after */
const WIDE: TileSize = { slot: 128, name: 13, info: 11, reason: 11 };
const SMALL: TileSize = { slot: 64, name: 11, info: 10, reason: 9 };
/** The gap between tiles */
const GAP = 8;
/** A picture's edge is a faint ink square, so a small thumbnail's canvas shows where it ends */
const EDGE_ALPHA = 0.25;

export interface AssetShelfOptions {
  stage: ThemeSource;
  screen: Rectangle;
  /** Every mesh in the scene, so a caption can say how many draw its geometry */
  meshes: readonly Mesh3D[];
  /** One tile per geometry, in this order */
  geometries: readonly Geometry3D[];
}

/** One tile per geometry */
export class AssetShelf extends Panel {
  private readonly _meshes: readonly Mesh3D[];
  private readonly _tiles: ShelfTile[];
  /** The pictures' edges and the placeholders' dashed squares, redrawn when a tile changes */
  private readonly _marks: ScreenLines;
  private _size: TileSize = WIDE;
  /** The width the tiles were last arranged for */
  private _arrangedFor = -1;

  constructor({ stage, screen, meshes, geometries }: AssetShelfOptions) {
    super({ stage, screen, corner: 'bottom', title: 'asset shelf' });
    this._meshes = meshes;
    this._tiles = geometries.map(() => this.addChild(new ShelfTile()));
    this._marks = this.addChild(new ScreenLines({ stage }));
    this.note = `${geometries.length} geometries · ${meshes.length} meshes`;
    geometries.forEach((geometry, i) => this.setGeometry(i, geometry));
    // The first update measures the room and arranges the tiles, so `slot` is right from the start.
    this.update();
  }

  /** A picture's side in px, for picking a thumbnail size that matches the screen */
  get slot(): number {
    return this._size.slot;
  }

  /** Captions tile `i` for `geometry`: its first mesh's name, how many meshes draw it, and its triangles */
  public setGeometry(i: number, geometry: Geometry3D): void {
    const users = this._meshes.filter((mesh) => mesh.geometry === geometry);

    this._tiles[i].caption(`${users[0]?.label ?? 'geometry'}${users.length > 1 ? ` ×${users.length}` : ''}`, geometry);
  }

  /** Shows `texture` in tile `i` */
  public setTexture(i: number, texture: Texture): void {
    this._tiles[i].showTexture(texture);
    this._drawMarks();
  }

  /** Shows a placeholder in tile `i` naming why it has no picture */
  public setReason(i: number, reason: string): void {
    this._tiles[i].showReason(reason);
    this._drawMarks();
  }

  /** Docks and follows the theme, then arranges the tiles again when the room across the screen changed */
  public override update(dt = 0): void {
    super.update(dt);
    if (this.availableWidth !== this._arrangedFor) this._arrange();
    this._marks.update();
  }

  protected override paint(darkness: number): void {
    super.paint(darkness);
    for (const tile of this._tiles) tile.paint(darkness);
  }

  /** One row of 128 px pictures where it fits, else 64 px ones in one row or two */
  private _arrange(): void {
    const room = this.availableWidth - this.padding * 2;
    const count = this._tiles.length;
    const rowWidth = (size: TileSize): number => count * (tileExtent(size).width + GAP) - GAP;

    this._size = rowWidth(WIDE) <= room ? WIDE : SMALL;

    const columns = rowWidth(this._size) <= room ? count : Math.ceil(count / 2);
    const { width, height } = tileExtent(this._size);
    const top = this.contentTop;

    this._tiles.forEach((tile, i) => {
      tile.arrange(this._size);
      tile.position.set(this.padding + (i % columns) * (width + GAP), top + Math.floor(i / columns) * (height + GAP));
    });
    this.setSize(
      columns * (width + GAP) - GAP + this.padding * 2,
      top + Math.ceil(count / columns) * (height + GAP) - GAP + this.padding,
    );
    this._arrangedFor = this.availableWidth;
    this._drawMarks();
  }

  /** Redraws each picture's edge and the placeholders' dashed squares */
  private _drawMarks(): void {
    const { slot } = this._size;
    const inset = slot / 16;

    this._marks.clear();
    for (const tile of this._tiles) {
      const x = tile.x + TILE_PAD;
      const y = tile.y + TILE_PAD;

      if (tile.hasPicture) this._marks.style('ink', 1, EDGE_ALPHA).rect(x, y, slot, slot);
      else this._marks.style('ink', 1, 0.7, 4, 3).rect(x + inset, y + inset, slot - inset * 2, slot - inset * 2, 4);
    }
  }
}
