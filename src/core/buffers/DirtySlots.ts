import { isMobile } from 'pixi.js';

/**
 * Bytes one storage-buffer upload call costs, counted as bytes it could have moved instead; set for
 * phones, since a value tuned on desktop costs a phone over 1.5 ms a frame
 * @internal
 */
export const BUFFER_CALL_BYTES = 8192;

/**
 * {@link BUFFER_CALL_BYTES} for a data texture, whose upload calls cost more
 * @internal
 */
export const TEXTURE_CALL_BYTES = 16384;

/**
 * Smallest span a storage buffer splits into runs on Android, where Chrome writes a smaller span
 * cheaply and runs cost Mali phones more
 * @internal
 */
export const BUFFER_SPAN_FLOOR_BYTES = isMobile.android.device ? 4 * 1024 * 1024 : 0;

const MERGE_GAP_BYTES = 768;

const FULL_WORD = 0xffffffff;

/** @internal */
export class DirtySlots {
  /** Lowest changed slot, or `Infinity` when nothing changed */
  public min = Infinity;

  /** Highest changed slot, or `-Infinity` when nothing changed */
  public max = -Infinity;

  public spanOnly = false;

  /** Start and end slot of each run, end exclusive */
  public runs = new Int32Array(64);

  public runCount = 0;
  public runSlots = 0;
  private _bits: Uint32Array;
  private readonly _slotBytes: number = 0;
  private _hasBits = false;
  private _collected = false;

  constructor(capacity: number, slotBytes: number) {
    this._bits = new Uint32Array((capacity + 31) >>> 5);
    this._slotBytes = slotBytes;
  }

  public get isEmpty(): boolean {
    return this.min > this.max;
  }

  public mark(slot: number): void {
    if (slot < this.min) this.min = slot;
    if (slot > this.max) this.max = slot;
    if (this.spanOnly) return;

    const word = slot >>> 5;
    const bit = 1 << (slot & 31);
    const bits = this._bits[word];
    if ((bits & bit) !== 0) return;
    this._bits[word] = bits | bit;
    this._hasBits = true;
  }

  public markRange(from: number, to: number): void {
    if (from < this.min) this.min = from;
    if (to > this.max) this.max = to;
    this.spanOnly = true;
  }

  /** Takes a full word 32 slots at a time, so a frame that moves every slot costs a step per word */
  public planRuns(): void {
    if (this.spanOnly || this.isEmpty) return;

    const bits = this._bits;
    const gapSlots = Math.floor(MERGE_GAP_BYTES / this._slotBytes);
    const last = this.max >>> 5;
    let runCount = 0;
    let runSlots = 0;
    let start = -1;
    let end = -1;

    for (let w = this.min >>> 5; w <= last; w++) {
      let word = bits[w];
      if (word === 0) continue;
      bits[w] = 0;

      if (word === FULL_WORD) {
        const first = w << 5;
        if (end >= 0 && first - end <= gapSlots) {
          end = first + 32;
        } else {
          if (end >= 0) {
            runSlots += end - start;
            runCount = this._pushRun(runCount, start, end);
          }
          start = first;
          end = first + 32;
        }
        continue;
      }

      while (word !== 0) {
        const slot = (w << 5) | (31 - Math.clz32(word & -word));
        word &= word - 1;

        if (end >= 0 && slot - end <= gapSlots) {
          end = slot + 1;
        } else {
          if (end >= 0) {
            runSlots += end - start;
            runCount = this._pushRun(runCount, start, end);
          }
          start = slot;
          end = slot + 1;
        }
      }
    }

    if (end >= 0) {
      runSlots += end - start;
      runCount = this._pushRun(runCount, start, end);
    }

    this.runCount = runCount;
    this.runSlots = runSlots;
    this._collected = true;
  }

  public runsBeatSpan(callBytes: number, spanFloorBytes = 0): boolean {
    if (this.spanOnly || !this._collected) return false;
    const slotBytes = this._slotBytes;
    const spanBytes = (this.max - this.min + 1) * slotBytes;
    return spanBytes >= spanFloorBytes && this.runCount * callBytes + this.runSlots * slotBytes < spanBytes;
  }

  /**
   * Forgets every change, clearing the bits `planRuns` left, as when a bulk range claimed the upload or
   * no GPU view needed a plan
   */
  public clear(): void {
    if (!this._collected && this._hasBits) {
      this._bits.fill(0, this.min >>> 5, (this.max >>> 5) + 1);
    }
    this.min = Infinity;
    this.max = -Infinity;
    this.spanOnly = false;
    this.runCount = 0;
    this.runSlots = 0;
    this._hasBits = false;
    this._collected = false;
  }

  public grow(capacity: number): void {
    const words = (capacity + 31) >>> 5;
    if (words <= this._bits.length) return;
    const bits = new Uint32Array(words);
    bits.set(this._bits);
    this._bits = bits;
  }

  private _pushRun(runCount: number, start: number, end: number): number {
    if (runCount * 2 + 2 > this.runs.length) {
      const runs = new Int32Array(this.runs.length * 2);
      runs.set(this.runs);
      this.runs = runs;
    }
    this.runs[runCount * 2] = start;
    this.runs[runCount * 2 + 1] = end;
    return runCount + 1;
  }
}
