import { describe, expect, it } from 'vitest';

import { GraphDebugRecording } from '../GraphDebugRecording';
import type { GraphDebugBundleSnapshot, GraphDebugDrawBuildSnapshot, GraphDebugSnapshot } from '../GraphDebugSnapshot';

describe('GraphDebugRecording', () => {
  it('records complete serialisable frames with timing and rebuild summaries', () => {
    const recording = new GraphDebugRecording();

    recording.start(100);
    expect(recording.record(makeSnapshot(1, 'reused'), 116)).toBe('recorded');
    expect(recording.record(makeSnapshot(2, 'rebuilt'), 132)).toBe('recorded');
    recording.stop(150);

    expect(recording.toJSON()).toMatchObject({
      version: 2,
      frameCount: 2,
      durationMs: 50,
      stopReason: 'manual',
      frames: [
        { index: 0, elapsedMs: 16, drawRebuiltBatchPassCount: 0, dynamicDrawBatchPassCount: 0 },
        { index: 1, elapsedMs: 32, drawRebuiltBatchPassCount: 1, dynamicDrawBatchPassCount: 0 },
      ],
    });
    expect(() => JSON.parse(JSON.stringify(recording))).not.toThrow();
  });

  it('auto-stops at the configured frame safety limit', () => {
    const recording = new GraphDebugRecording({ maxFrames: 2 });

    recording.start(10);
    expect(recording.record(makeSnapshot(1, 'first-capture'), 10)).toBe('recorded');
    expect(recording.record(makeSnapshot(2, 'reused'), 26)).toBe('frame-limit');
    expect(recording.record(makeSnapshot(3, 'rebuilt'), 42)).toBe('inactive');

    expect(recording.active).toBe(false);
    expect(recording.toJSON()).toMatchObject({
      frameCount: 2,
      durationMs: 16,
      stopReason: 'frame-limit',
      frames: [{ firstCaptureBatchPassCount: 1 }, { firstCaptureBatchPassCount: 0 }],
    });
  });

  it('keeps the default bound when given a non-finite frame limit', () => {
    expect(new GraphDebugRecording({ maxFrames: Number.POSITIVE_INFINITY }).maxFrames).toBe(3_600);
    expect(new GraphDebugRecording({ maxFrames: Number.NaN }).maxFrames).toBe(3_600);
  });

  it('reads its frame cap from defaultOptions', () => {
    const defaults = { ...GraphDebugRecording.defaultOptions };

    try {
      GraphDebugRecording.defaultOptions.maxFrames = 10;

      expect(new GraphDebugRecording().maxFrames).toBe(10);
      expect(new GraphDebugRecording({ maxFrames: undefined }).maxFrames).toBe(10);
      expect(new GraphDebugRecording({ maxFrames: Number.NaN }).maxFrames).toBe(10);
    } finally {
      GraphDebugRecording.defaultOptions = defaults;
    }
  });

  it('counts dynamic passes separately from rebuilds', () => {
    const recording = new GraphDebugRecording();

    recording.start(0);
    recording.record(makeSnapshot(1, 'dynamic'), 16);
    recording.stop(16);

    expect(recording.frames[0]).toMatchObject({
      drawRebuiltBatchPassCount: 0,
      dynamicDrawBatchPassCount: 1,
      firstCaptureBatchPassCount: 0,
    });
  });

  it('counts bundle recordings separately from draw rebuilds', () => {
    const recording = new GraphDebugRecording();

    recording.start(0);
    recording.record(makeSnapshot(1, 'reused', 'recorded'), 16);
    recording.stop(16);

    expect(recording.frames[0]).toMatchObject({
      drawRebuiltBatchPassCount: 0,
      bundleRecordedBatchPassCount: 1,
      bundleInvalidatedBatchPassCount: 0,
    });
  });
});

function makeSnapshot(
  captureId: number,
  drawStatus: GraphDebugDrawBuildSnapshot['status'],
  bundleStatus: GraphDebugBundleSnapshot['status'] = 'not-used',
): GraphDebugSnapshot {
  return {
    version: 4,
    captureId,
    graph: { passes: [], resources: [] },
    summary: {
      batchCount: 1,
      meshCount: 0,
      submittedMeshCount: 0,
      geometryCount: 0,
      materialCount: 0,
      textureCount: 0,
      drawCallCount: 0,
      sourceInstanceCount: 0,
      drawnInstanceCount: 0,
    },
    batches: [
      {
        id: 1,
        label: 'scene',
        slotCount: 0,
        meshCount: 0,
        submittedMeshCount: 0,
        geometryCount: 0,
        materialCount: 0,
        textureCount: 0,
        drawCallCount: 0,
        sourceInstanceCount: 0,
        drawnInstanceCount: 0,
        passes: [
          {
            name: 'opaque',
            bit: 2,
            renderableCount: 0,
            drawCallCount: 0,
            sourceInstanceCount: 0,
            drawnInstanceCount: 0,
            drawBuild: {
              status: drawStatus,
              commandListDirtyId: captureId,
              causes: drawStatus === 'rebuilt' ? [{ code: 'material-changed' }] : [],
            },
            bundle: {
              status: bundleStatus,
              bundleDirtyId: bundleStatus === 'not-used' ? null : captureId,
              lastBundleDirtyId: bundleStatus === 'not-used' ? null : captureId,
              causes: bundleStatus === 'recorded' ? [{ code: 'bundle-only-change' }] : [],
            },
            draws: [],
          },
        ],
      },
    ],
    meshes: [],
    geometries: [],
    materials: [],
    textures: [],
  };
}
