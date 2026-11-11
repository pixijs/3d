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
 * One recorded frame: its {@link GraphDebugSnapshot} and counts of its batch passes by status, for
 * scanning a timeline without walking every snapshot
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugRecordedFrame {
  /** Zero-based position within this recording */
  index: number;
  /** Time since recording started, in milliseconds */
  elapsedMs: number;
  /** Count of batch passes that rebuilt their draw commands this frame */
  drawRebuiltBatchPassCount: number;
  /** Count of batch passes that rebuild their draw commands every frame */
  dynamicDrawBatchPassCount: number;
  /** Count of batch passes that recorded a new WebGPU bundle this frame */
  bundleRecordedBatchPassCount: number;
  /** Count of batch passes still waiting to record their WebGPU bundle when this frame was captured */
  bundleInvalidatedBatchPassCount: number;
  /** Count of batch passes captured for the first time this frame */
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
   * Frame cap for one recording, so a forgotten recording can't grow forever; the default is a
   * minute at 60 fps
   *
   * Clamped to at least one frame; a non-finite value, `Infinity` included, falls back to the default.
   * @default 3600
   */
  maxFrames?: number;
}

/**
 * Stores one {@link GraphDebugSnapshot} per rendered frame, up to a frame cap
 *
 * It captures nothing itself: pass each frame's snapshot to {@link GraphDebugRecording#record}
 * between {@link GraphDebugRecording#start} and {@link GraphDebugRecording#stop}.
 * @category extras:debug
 * @advanced
 */
export class GraphDebugRecording {
  /**
   * Defaults for every new `GraphDebugRecording`; an option passed as `undefined` keeps its default
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

  /** @param options - Options for the recording */
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
   * Stores a frame while recording; the frame that reaches the cap stops the recording
   * @param snapshot - The frame's snapshot
   * @param timestamp - Capture time in milliseconds
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

  /** Returns the recording as JSON-serialisable data */
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
