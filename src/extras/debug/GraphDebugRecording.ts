import { definedProps } from 'pixi.js';

import type { GraphDebugSnapshot } from './GraphDebugSnapshot';

/**
 * Serialization version stamped onto every {@link GraphDebugRecordingSnapshot}
 * @category extras:debug
 * @advanced
 */
export const GRAPH_DEBUG_RECORDING_VERSION = 2;

/**
 * Why a recording stopped: it hit its frame cap, or {@link GraphDebugRecording#stop} was called
 * @category extras:debug
 * @advanced
 */
export type GraphDebugRecordingStopReason = 'frame-limit' | 'manual';

/**
 * One recorded frame: a complete {@link GraphDebugSnapshot} plus pre-aggregated batch-pass counts
 *
 * The counts summarise the draw-build and bundle statuses inside the snapshot so a recording
 * timeline can be scanned without walking every batch pass of every frame.
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugRecordedFrame {
  /** Zero-based position within this recording */
  index: number;
  /** Time since recording started, in milliseconds */
  elapsedMs: number;
  /** Batch passes whose retained draw commands were rebuilt this frame */
  drawRebuiltBatchPassCount: number;
  /** Batch passes that rebuild their draw commands every frame by design */
  dynamicDrawBatchPassCount: number;
  /** Batch passes that recorded a new WebGPU bundle this frame */
  bundleRecordedBatchPassCount: number;
  /** Batch passes whose WebGPU bundle was invalidated this frame */
  bundleInvalidatedBatchPassCount: number;
  /** Batch passes captured for the first time this frame */
  firstCaptureBatchPassCount: number;
  /** The complete render snapshot captured for this frame */
  snapshot: GraphDebugSnapshot;
}

/**
 * JSON shape produced by {@link GraphDebugRecording#toJSON}
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugRecordingSnapshot {
  /** Serialization version of this shape */
  version: typeof GRAPH_DEBUG_RECORDING_VERSION;
  /** Number of recorded frames */
  frameCount: number;
  /** Span from recording start to the most recent recorded frame or stop, in milliseconds */
  durationMs: number;
  /** Why the recording stopped; null while it is still active */
  stopReason: GraphDebugRecordingStopReason | null;
  /** The recorded frames, in capture order */
  frames: GraphDebugRecordedFrame[];
}

/**
 * Outcome of {@link GraphDebugRecording#record}: the frame was stored, ignored because no
 * recording is active, or stored as the final frame before the cap stopped the recording
 * @category extras:debug
 * @advanced
 */
export type GraphDebugRecordResult = 'frame-limit' | 'inactive' | 'recorded';

/**
 * Constructor options for {@link GraphDebugRecording}
 * @example
 * ```ts
 * const recording = new GraphDebugRecording({ maxFrames: 600 });
 * ```
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugRecordingOptions {
  /**
   * Frame cap for one recording, so a forgotten recording can't grow forever
   *
   * Clamped to at least one frame; a non-finite value falls back to the default.
   * @default 3600
   */
  maxFrames?: number;
}

/**
 * Debug-only, bounded collection of complete per-frame render snapshots
 *
 * Recording is passive: feed {@link GraphDebugRecording#record} one snapshot per rendered frame
 * and it stores the frame with pre-aggregated batch-pass counts until
 * {@link GraphDebugRecording#stop} is called or the frame cap is reached.
 * @category extras:debug
 * @advanced
 */
export class GraphDebugRecording {
  /**
   * Default {@link GraphDebugRecordingOptions} merged under every constructor call
   *
   * `new GraphDebugRecording(opts)` resolves as `{ ...GraphDebugRecording.defaultOptions, ...opts }`. The
   * 3,600-frame cap is one minute at 60fps.
   * @example
   * ```ts
   * GraphDebugRecording.defaultOptions.maxFrames = 600;
   * ```
   */
  public static defaultOptions: GraphDebugRecordingOptions = {
    maxFrames: 3_600,
  };

  private readonly _maxFrames: number = 0;
  private readonly _frames: GraphDebugRecordedFrame[] = [];
  private _active = false;
  private _startedAt = 0;
  private _stoppedAt = 0;
  private _stopReason: GraphDebugRecordingStopReason | null = null;

  /** @param options - Recording options; see {@link GraphDebugRecordingOptions} */
  constructor(options: GraphDebugRecordingOptions = {}) {
    const fallback = GraphDebugRecording.defaultOptions.maxFrames!;
    const { maxFrames } = { ...GraphDebugRecording.defaultOptions, ...definedProps(options) };

    this._maxFrames = Math.max(1, Math.floor(Number.isFinite(maxFrames) ? maxFrames! : fallback));
  }

  /** Whether frames are currently being recorded */
  public get active(): boolean {
    return this._active;
  }

  /** Frames recorded so far, in capture order */
  public get frames(): readonly GraphDebugRecordedFrame[] {
    return this._frames;
  }

  /** Maximum number of frames one recording stores before stopping itself */
  public get maxFrames(): number {
    return this._maxFrames;
  }

  /**
   * Begin a new recording, discarding any previously recorded frames
   * @param timestamp - Start time in milliseconds; recorded `elapsedMs` values are relative to it
   */
  public start(timestamp = performance.now()): void {
    this._frames.length = 0;
    this._active = true;
    this._startedAt = timestamp;
    this._stoppedAt = timestamp;
    this._stopReason = null;
  }

  /**
   * Store one frame, deriving its batch-pass counts from the snapshot
   *
   * Recording stops automatically once the frame cap is reached.
   * @param snapshot - The frame's complete render snapshot
   * @param timestamp - Capture time in milliseconds
   * @returns Whether the frame was recorded, ignored, or recorded as the final frame at the cap
   */
  public record(snapshot: GraphDebugSnapshot, timestamp = performance.now()): GraphDebugRecordResult {
    if (!this._active) return 'inactive';

    const counts = countWorkStatuses(snapshot);
    this._frames.push({
      index: this._frames.length,
      elapsedMs: Math.max(0, timestamp - this._startedAt),
      drawRebuiltBatchPassCount: counts.drawRebuilt,
      dynamicDrawBatchPassCount: counts.dynamicDraw,
      bundleRecordedBatchPassCount: counts.bundleRecorded,
      bundleInvalidatedBatchPassCount: counts.bundleInvalidated,
      firstCaptureBatchPassCount: counts.firstCapture,
      snapshot,
    });
    this._stoppedAt = timestamp;

    if (this._frames.length < this._maxFrames) return 'recorded';

    this.stop(timestamp, 'frame-limit');
    return 'frame-limit';
  }

  /**
   * Stop the active recording, keeping the recorded frames
   * @param timestamp - Stop time in milliseconds, closing the recording's duration
   * @param reason - Why the recording stopped
   */
  public stop(timestamp = performance.now(), reason: GraphDebugRecordingStopReason = 'manual'): void {
    if (!this._active) return;
    this._active = false;
    this._stoppedAt = timestamp;
    this._stopReason = reason;
  }

  /**
   * Snapshot the recording as plain JSON-serialisable data
   * @returns The versioned recording snapshot, with a copy of the frame list
   */
  public toJSON(): GraphDebugRecordingSnapshot {
    return {
      version: GRAPH_DEBUG_RECORDING_VERSION,
      frameCount: this._frames.length,
      durationMs: Math.max(0, this._stoppedAt - this._startedAt),
      stopReason: this._stopReason,
      frames: this._frames.slice(),
    };
  }
}

/**
 * Tally draw-build and bundle statuses across every batch pass in the snapshot
 * @param snapshot - Snapshot to tally
 */
function countWorkStatuses(snapshot: GraphDebugSnapshot): {
  bundleInvalidated: number;
  bundleRecorded: number;
  drawRebuilt: number;
  dynamicDraw: number;
  firstCapture: number;
} {
  let bundleInvalidated = 0;
  let bundleRecorded = 0;
  let drawRebuilt = 0;
  let dynamicDraw = 0;
  let firstCapture = 0;

  for (const batch of snapshot.batches) {
    for (const pass of batch.passes) {
      if (pass.drawBuild.status === 'rebuilt') drawRebuilt++;
      else if (pass.drawBuild.status === 'dynamic') dynamicDraw++;
      else if (pass.drawBuild.status === 'first-capture') firstCapture++;

      if (pass.bundle.status === 'recorded') bundleRecorded++;
      else if (pass.bundle.status === 'invalidated') bundleInvalidated++;
    }
  }

  return { bundleInvalidated, bundleRecorded, drawRebuilt, dynamicDraw, firstCapture };
}
