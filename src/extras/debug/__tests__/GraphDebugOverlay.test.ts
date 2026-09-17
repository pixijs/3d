import { getApp } from '@test-utils';
import { RenderTexture, SystemRunner } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import type { View3D } from '~/scene/View3D';

import type { GeometryThumbnailGenerator } from '../GeometryThumbnailGenerator';
import { GraphDebugOverlay } from '../GraphDebugOverlay';
import type { GraphDebugSnapshot } from '../GraphDebugSnapshot';

describe('GraphDebugOverlay', () => {
  it('renders the workload batch and draw inspector after recording', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    const geometry = new PlaneGeometry();
    Object.defineProperty(geometry, 'uid', { value: 10 });
    const internals = overlay as unknown as {
      _debugger: { capture: (captureGeometry?: (geometry: PlaneGeometry) => void) => GraphDebugSnapshot };
    };
    const capture = vi.fn<(captureGeometry?: (geometry: PlaneGeometry) => void) => GraphDebugSnapshot>(
      (captureGeometry) => {
        captureGeometry?.(geometry);
        return SNAPSHOT;
      },
    );
    internals._debugger.capture = capture;

    overlay.refresh();

    expect(capture).not.toHaveBeenCalled();
    expect(parent.textContent).toContain('Ready. No render data is captured until recording starts.');
    expect(parent.textContent).not.toContain('1 batches · 1 draws');
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(parent.textContent).toContain('Capturing every frame. Stop to review the recording.');
    expect(parent.textContent).not.toContain('1 batches · 1 draws');
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('material changed');

    expect(parent.textContent).toContain('Workload · Capture 3');
    expect(parent.textContent).toContain('opaque batches');
    expect(parent.textContent).toContain('Draws opaque scene geometry into scene color and depth.');
    expect(parent.textContent).toContain('Draw rebuild causes');
    expect(parent.textContent).toContain('bundle recorded');
    expect(parent.textContent).toContain('The draw rebuild required a fresh bundle recording.');
    expect(parent.textContent).toContain('Draw calls · 1');
    expect(parent.querySelector('.p3d-debug__draw-details')).toBeNull();

    const collapsedDraw = parent.querySelector<HTMLButtonElement>('button.p3d-debug__draw-row')!;
    expect(collapsedDraw.lastElementChild?.textContent).toBe('');
    expect(parent.textContent).not.toContain('Geometry3D #10');
    collapsedDraw.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(parent.textContent).toContain('Material3D #20');
    expect(parent.textContent).toContain('baseColorTexture → albedo · 256×128 rgba8unorm · 4 mips');
    expect(parent.querySelectorAll('[aria-label="Geometry3D thumbnail"]')).toHaveLength(2);
    expect(parent.textContent).toContain('Geometry3D #10');
    expect(parent.textContent).toContain('GPU-cull survivor counts mirrored on CPU.');
    const drawRow = parent.querySelector('.p3d-debug__draw-row--selected')!;
    expect(drawRow.getAttribute('aria-expanded')).toBe('true');
    expect(drawRow.nextElementSibling?.classList.contains('p3d-debug__draw-details')).toBe(true);
    expect(drawRow.lastElementChild?.textContent).toBe('');
    expect(drawRow.lastElementChild?.querySelector('[aria-label="Geometry3D thumbnail"]')).not.toBeNull();

    (drawRow as HTMLButtonElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.querySelector('.p3d-debug__draw-details')).toBeNull();

    overlay.destroy();
    geometry.destroy();
    expect(parent.childElementCount).toBe(0);
    parent.remove();
  });

  it('preserves inspector scrolling across frame refreshes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    const draw = SNAPSHOT.batches[0].passes[0].draws[0];
    const pass = SNAPSHOT.batches[0].passes[0];
    const snapshot: GraphDebugSnapshot = {
      ...SNAPSHOT,
      batches: [
        {
          ...SNAPSHOT.batches[0],
          passes: [
            {
              ...pass,
              drawCallCount: 100,
              draws: Array.from({ length: 100 }, (_, index) => ({ ...draw, index })),
            },
          ],
        },
      ],
    };
    const internals = overlay as unknown as {
      _debugger: { capture: () => GraphDebugSnapshot };
    };
    internals._debugger.capture = () => snapshot;

    overlay.refresh();
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    const inspector = parent.querySelectorAll<HTMLElement>('.p3d-debug__panel')[2];
    expect(inspector.scrollHeight).toBeGreaterThan(inspector.clientHeight);
    inspector.scrollTop = inspector.scrollHeight;
    expect(inspector.scrollTop).toBeGreaterThan(0);

    const inspectorBeforeRefresh = parent.querySelectorAll<HTMLElement>('.p3d-debug__panel')[2];
    overlay.refresh();

    expect(inspectorBeforeRefresh).toBe(inspector);
    expect(parent.querySelectorAll<HTMLElement>('.p3d-debug__panel')[2]).toBe(inspector);
    expect(inspector.scrollTop).toBeGreaterThan(0);

    overlay.destroy();
    parent.remove();
  });

  it('separates scene workload from the complete render graph', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    const opaque = SNAPSHOT.graph.passes[0];
    const snapshot: GraphDebugSnapshot = {
      ...SNAPSHOT,
      graph: {
        ...SNAPSHOT.graph,
        passes: [
          { ...opaque, name: 'shadow', sceneWorkload: 'shadow', isAnchored: false, passIdx: 0 },
          {
            ...opaque,
            name: 'copyDepth',
            sceneWorkload: null,
            active: false,
            passIdx: null,
            isAnchored: false,
            dependsOn: [0],
          },
          {
            ...opaque,
            name: 'depthClear',
            sceneWorkload: null,
            passIdx: 1,
            dependsOn: [1],
            accesses: [{ mode: 'produce', handleId: 1, handleKind: 'depth', effectiveLoadOp: null }],
            acquires: [1],
          },
          {
            ...opaque,
            passIdx: 2,
            accesses: [{ mode: 'sample', handleId: 1, handleKind: 'depth', slot: 2, effectiveLoadOp: null }],
            dependsOn: [2],
            releases: [1],
          },
        ],
        resources: [
          ...SNAPSHOT.graph.resources,
          {
            id: 1,
            kind: 'transient',
            type: 'depth',
            isDefaultColor: false,
            isDefaultDepth: false,
            firstUse: 1,
            lastUse: 2,
          },
          {
            id: 2,
            kind: 'transient',
            type: 'color',
            isDefaultColor: false,
            isDefaultDepth: false,
            firstUse: null,
            lastUse: null,
          },
        ],
      },
    };
    const internals = overlay as unknown as {
      _debugger: { capture: () => GraphDebugSnapshot };
    };
    internals._debugger.capture = () => snapshot;

    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    const passPanel = parent.querySelectorAll<HTMLElement>('.p3d-debug__panel')[0];
    expect(passPanel.textContent).toContain('Scene Passes');
    expect(passPanel.textContent).toContain('shadow');
    expect(passPanel.textContent).toContain('opaque');
    expect(passPanel.textContent).not.toContain('depthClear');
    expect(passPanel.textContent).not.toContain('copyDepth');
    expect(passPanel.querySelector('.p3d-debug__status--no-draws')?.textContent).toBe('no draws');
    expect(parent.textContent).toContain('No scene draws were submitted for this pass.');

    findButton(parent, 'Render Graph').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    const graphView = parent.querySelector<HTMLElement>('.p3d-debug__graph-view')!;
    expect(parent.textContent).toContain('Render Graph · Capture 3');
    expect(graphView.innerText).toContain('Declared Passes & Dependencies');
    expect(graphView.innerText).toContain('shadow');
    expect(graphView.innerText).toContain('depthClear');
    expect(graphView.innerText).toContain('opaque');
    expect(graphView.innerText).toContain('Draws opaque scene geometry into scene color and depth.');
    expect(graphView.innerText).toContain('copyDepth');
    expect(graphView.innerText).toContain('← shadow · active');
    expect(graphView.innerText).toContain('← copyDepth · skipped');
    expect(graphView.innerText).toContain('← depthClear · active');
    expect(graphView.innerText).toContain('ANCHORED OUTPUT');
    expect(graphView.innerText).toContain('Resource Lifetimes');
    expect(graphView.innerText).toContain('defaultColor');
    expect(graphView.innerText).toContain('T1:depth');
    expect(graphView.innerText).toContain('T2:color');
    expect(graphView.innerText).toContain('external');
    expect(graphView.innerText).toContain('unused this frame');
    expect(graphView.innerText).not.toContain('batches');
    expect(graphView.innerText).not.toContain('draws');
    expect(parent.textContent).toContain('3/4 active · 3 resources');
    expect(parent.querySelector<HTMLElement>('.p3d-debug__lifetime')?.title).toBe('depthClear → opaque');
    const graphPasses = parent.querySelectorAll<HTMLElement>('.p3d-debug__graph-pass');
    expect(
      [...graphPasses[0].querySelectorAll('.p3d-debug__graph-pass-index')].map((item) => item.textContent),
    ).toEqual(['D0', 'E0']);
    expect(
      [...graphPasses[1].querySelectorAll('.p3d-debug__graph-pass-index')].map((item) => item.textContent),
    ).toEqual(['D1', 'E—']);
    expect(graphPasses[2].querySelector('.p3d-debug__graph-link--skipped')?.textContent).toBe('← copyDepth · skipped');
    expect(findButton(parent, '‹ Frame').disabled).toBe(true);
    expect(findButton(parent, 'Frame ›').disabled).toBe(true);
    expect(findButton(parent, 'Render Graph').disabled).toBe(true);

    findButton(parent, 'Workload').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Workload · Capture 3');

    overlay.destroy();
    parent.remove();
  });

  it('shows source and drawn instance counts when culling changes them', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    const snapshot = snapshotWithDrawnInstances(0);
    const internals = overlay as unknown as {
      _debugger: { capture: () => GraphDebugSnapshot };
    };
    internals._debugger.capture = () => snapshot;

    overlay.refresh();
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    const drawCells = parent.querySelector<HTMLButtonElement>('.p3d-debug__draw-row:not(.p3d-debug__subtle)')!.children;
    expect(drawCells[1].textContent).toBe('2→0');
    expect(drawCells[2].textContent).toBe('4→0');

    overlay.destroy();
    parent.remove();
  });

  it('shows a clean fallback for unsupported dynamic geometry', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    const geometry = new Geometry3D({
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      dynamic: true,
    });
    Object.defineProperty(geometry, 'uid', { value: 10 });
    const snapshot: GraphDebugSnapshot = {
      ...SNAPSHOT,
      geometries: [{ ...SNAPSHOT.geometries[0], dynamic: true }],
    };
    const internals = overlay as unknown as {
      _debugger: { capture: (captureGeometry?: (geometry: Geometry3D) => void) => GraphDebugSnapshot };
    };
    internals._debugger.capture = (captureGeometry) => {
      captureGeometry?.(geometry);
      return snapshot;
    };

    overlay.refresh();
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    parent
      .querySelector<HTMLButtonElement>('button.p3d-debug__draw-row')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    const fallback = [...parent.querySelectorAll<HTMLElement>('.p3d-debug__geometry-placeholder')].find(
      (item) => item.textContent === 'No preview',
    )!;
    expect(fallback.title).toBe('dynamic');
    expect(parent.textContent).toContain('triangle list · dynamic');

    overlay.destroy();
    geometry.destroy();
    parent.remove();
  });

  it('retains thumbnail images only for the current snapshot and recorded frames', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    const firstGeometry = new PlaneGeometry();
    const secondGeometry = new PlaneGeometry();
    Object.defineProperty(firstGeometry, 'uid', { value: 10 });
    Object.defineProperty(secondGeometry, 'uid', { value: 11 });
    let geometry = firstGeometry;
    let snapshot = SNAPSHOT;
    const internals = overlay as unknown as {
      _debugger: { capture: (captureGeometry?: (geometry: PlaneGeometry) => void) => GraphDebugSnapshot };
      _geometryThumbnails: GeometryThumbnailGenerator;
    };
    internals._debugger.capture = (captureGeometry) => {
      captureGeometry?.(geometry);
      return snapshot;
    };

    overlay.refresh();
    expect(internals._geometryThumbnails.getThumbnailById(10)).toBeUndefined();

    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(internals._geometryThumbnails.getThumbnailById(10)).toBeDefined();

    geometry = secondGeometry;
    snapshot = snapshotWithGeometry(4, 11);
    overlay.refresh();
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(internals._geometryThumbnails.getThumbnailById(10)).toBeDefined();
    expect(internals._geometryThumbnails.getThumbnailById(11)).toBeDefined();

    geometry = firstGeometry;
    snapshot = SNAPSHOT;
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(internals._geometryThumbnails.getThumbnailById(10)).toBeDefined();
    expect(internals._geometryThumbnails.getThumbnailById(11)).toBeUndefined();

    overlay.destroy();
    firstGeometry.destroy();
    secondGeometry.destroy();
    parent.remove();
  });

  it('keeps the current review until a replacement recording has a baseline', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    let snapshot: GraphDebugSnapshot | null = SNAPSHOT;
    const internals = overlay as unknown as {
      _debugger: { capture: () => GraphDebugSnapshot | null };
    };
    internals._debugger.capture = () => snapshot;

    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    findButton(parent, 'Render Graph').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    snapshot = null;
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Render Graph · Capture 3');
    expect(parent.textContent).toContain('Frame 1/1');
    expect(parent.textContent).toContain('Copy Recording');

    snapshot = snapshotWithStatus(4, 'first-capture');
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Render Graph · Capture 4');
    expect([...parent.querySelectorAll('button')].some((button) => button.textContent === 'Record New')).toBe(false);

    overlay.destroy();
    parent.remove();
  });

  it('records frames and opens the latest rebuild for timeline review', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    let snapshot = snapshotWithStatus(3, 'first-capture');
    const internals = overlay as unknown as {
      _debugger: { capture: () => GraphDebugSnapshot };
    };
    const capture = vi.fn<() => GraphDebugSnapshot>(() => snapshot);
    internals._debugger.capture = capture;

    overlay.refresh();
    expect(capture).not.toHaveBeenCalled();
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    const stop = findButton(parent, 'Stop', true);
    expect(stop.textContent).toBe('Stop · 1');
    expect(capture).toHaveBeenCalledTimes(1);

    snapshot = snapshotWithStatus(4, 'reused');
    overlay.refresh();
    expect(findButton(parent, 'Stop', true)).toBe(stop);
    expect(stop.textContent).toBe('Stop · 2');
    snapshot = snapshotWithStatus(5, 'rebuilt');
    overlay.refresh();
    snapshot = snapshotWithStatus(6, 'dynamic');
    overlay.refresh();

    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(parent.textContent).toContain('Workload · Capture 5');
    expect(parent.textContent).toContain('Frame 3/4');
    expect(parent.textContent).toContain('1 draw rebuild · 1 bundle recording');
    expect(parent.textContent).toContain('Copy Recording');
    expect(findButton(parent, 'Record')).toBeDefined();
    expect([...parent.querySelectorAll('button')].some((button) => button.textContent === 'Capture')).toBe(false);
    expect([...parent.querySelectorAll('button')].some((button) => button.textContent === 'Resume')).toBe(false);

    const range = parent.querySelector<HTMLInputElement>('[aria-label="Recorded frame"]')!;
    expect(range.value).toBe('2');
    expect(parent.querySelectorAll('.p3d-debug__timeline-marker')).toHaveLength(2);
    range.value = '3';
    range.dispatchEvent(new Event('change', { bubbles: true }));
    expect(parent.textContent).toContain('Workload · Capture 6');
    expect(parent.textContent).toContain('0 draw rebuilds · 0 bundle recordings · 1 dynamic pass');
    expect(parent.textContent).toContain('Regenerated every frame by pass policy.');
    expect(parent.querySelector('.p3d-debug__status--dynamic')).not.toBeNull();

    const updatedRange = parent.querySelector<HTMLInputElement>('[aria-label="Recorded frame"]')!;
    updatedRange.value = '0';
    updatedRange.dispatchEvent(new Event('change', { bubbles: true }));
    expect(parent.textContent).toContain('Workload · Capture 3');
    expect(parent.textContent).toContain('Baseline · Frame 1/4');

    findButton(parent, 'Change ›').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Workload · Capture 5');

    const clipboard = navigator.clipboard;
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const copy = vi.spyOn(document, 'execCommand').mockImplementation((command) => {
      if (command !== 'copy') return false;
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    try {
      findButton(parent, 'Copy Frame').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      expect(JSON.parse(copied).captureId).toBe(5);
      expect(parent.textContent).toContain('Frame copied');
    } finally {
      copy.mockRestore();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    }

    findButton(parent, 'Render Graph').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    const graphTimeline = parent.querySelector<HTMLElement>('.p3d-debug__timeline')!;
    expect(graphTimeline.innerText).toContain('1/1 active · 1 resources');
    expect(graphTimeline.innerText).not.toContain('rebuilt');
    expect(graphTimeline.innerText).not.toContain('draws');
    expect(parent.querySelectorAll('.p3d-debug__timeline-marker')).toHaveLength(0);
    findButton(parent, '‹ Frame').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Render Graph · Capture 4');
    expect(parent.querySelector<HTMLInputElement>('[aria-label="Recorded frame"]')?.value).toBe('1');
    findButton(parent, 'Hide').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.querySelector<HTMLElement>('[data-debug-state]')?.dataset.debugState).toBe('collapsed');
    expect(parent.querySelectorAll('button')).toHaveLength(1);
    expect(findButton(parent, 'Open Debugger')).toBeDefined();
    findButton(parent, 'Open Debugger').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Render Graph · Capture 4');
    expect(findButton(parent, 'Render Graph').disabled).toBe(true);
    expect(parent.querySelector<HTMLInputElement>('[aria-label="Recorded frame"]')?.value).toBe('1');
    findButton(parent, 'Frame ›').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Render Graph · Capture 5');

    capture.mockClear();
    overlay.refresh();
    expect(capture).not.toHaveBeenCalled();

    overlay.destroy();
    parent.remove();
  });

  it('shows and navigates bundle-only recordings as workload changes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, autoUpdate: false });
    let snapshot = snapshotWithStatus(3, 'first-capture');
    const internals = overlay as unknown as {
      _debugger: { capture: () => GraphDebugSnapshot };
    };
    internals._debugger.capture = () => snapshot;

    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    snapshot = snapshotWithBundleStatus(4, 'recorded');
    overlay.refresh();
    snapshot = snapshotWithStatus(5, 'reused');
    overlay.refresh();
    findButton(parent, 'Stop', true).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(parent.textContent).toContain('Workload · Capture 4');
    expect(parent.textContent).toContain('0 draw rebuilds · 1 bundle recording');
    expect(parent.textContent).toContain('draws reused');
    expect(parent.textContent).toContain('bundle recorded');
    expect(parent.textContent).toContain('Draw data was reused; bundle-only GPU state changed.');
    expect(parent.querySelectorAll('.p3d-debug__timeline-marker')).toHaveLength(2);
    expect(parent.querySelector('.p3d-debug__timeline-marker--bundle')).not.toBeNull();

    const range = parent.querySelector<HTMLInputElement>('[aria-label="Recorded frame"]')!;
    range.value = '0';
    range.dispatchEvent(new Event('change', { bubbles: true }));
    findButton(parent, 'Change ›').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Workload · Capture 4');

    overlay.destroy();
    parent.remove();
  });

  it('shows when recording auto-stops at its frame limit', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, maxRecordedFrames: 2, autoUpdate: false });
    let snapshot = snapshotWithStatus(3, 'first-capture');
    const internals = overlay as unknown as {
      _debugger: { capture: () => GraphDebugSnapshot };
    };
    const capture = vi.fn<() => GraphDebugSnapshot>(() => snapshot);
    internals._debugger.capture = capture;

    overlay.refresh();
    findButton(parent, 'Record').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(parent.textContent).toContain('Stop · 1');

    snapshot = snapshotWithStatus(4, 'rebuilt');
    overlay.refresh();

    expect(parent.textContent).toContain('Stopped at 2 frame limit');
    expect(parent.textContent).toContain('Frame 2/2');
    expect(parent.textContent).toContain('Workload · Capture 4');
    expect([...parent.querySelectorAll('button')].some((button) => button.textContent?.startsWith('Stop'))).toBe(false);

    capture.mockClear();
    overlay.refresh();
    expect(capture).not.toHaveBeenCalled();

    overlay.destroy();
    parent.remove();
  });

  it('refreshes after each screen render of the renderer it follows', async () => {
    const app = await getApp<Renderer>({ id: 'graph-debug-overlay-postrender', appOptions: { width: 8, height: 8 } });
    const parent = document.createElement('div');
    const view = { _graph: {} } as unknown as View3D;
    const overlay = new GraphDebugOverlay({ view, parent, renderer: app.renderer });
    const refresh = vi.spyOn(overlay, 'refresh').mockImplementation(() => {});
    const texture = RenderTexture.create({ width: 4, height: 4 });

    try {
      app.renderer.render(app.stage);
      expect(refresh).toHaveBeenCalledTimes(1);

      app.renderer.render({ container: app.stage, target: texture });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      texture.destroy(true);
      overlay.destroy();
      app.destroy();
    }
  });

  it('autoUpdate and renderer install and remove the postrender listener', () => {
    const parent = document.createElement('div');
    const view = { _graph: {} } as unknown as View3D;
    const postrender = new SystemRunner('postrender');
    const renderer = { runners: { postrender } } as unknown as Renderer;
    const overlay = new GraphDebugOverlay({ view, parent, renderer });
    const refresh = vi.spyOn(overlay, 'refresh').mockImplementation(() => {});

    expect(postrender.items).toHaveLength(1);

    overlay.autoUpdate = false;
    expect(postrender.items).toHaveLength(0);
    expect(overlay.renderer).toBe(renderer);

    overlay.autoUpdate = true;
    expect(postrender.items).toHaveLength(1);

    overlay.renderer = null;
    expect(postrender.items).toHaveLength(0);

    overlay.renderer = renderer;
    expect(postrender.items).toHaveLength(1);

    overlay.destroy();
    expect(postrender.items).toHaveLength(0);
    expect(overlay.renderer).toBeNull();

    overlay.renderer = renderer;
    overlay.autoUpdate = false;
    overlay.autoUpdate = true;
    expect(postrender.items).toHaveLength(0);
    expect(overlay.renderer).toBeNull();

    postrender.emit({});
    expect(refresh).not.toHaveBeenCalled();
    parent.remove();
  });
});

function findButton(parent: HTMLElement, label: string, startsWith = false): HTMLButtonElement {
  return [...parent.querySelectorAll('button')].find((button) =>
    startsWith ? button.textContent?.startsWith(label) : button.textContent === label,
  )!;
}

function snapshotWithStatus(
  captureId: number,
  status: GraphDebugSnapshot['batches'][number]['passes'][number]['drawBuild']['status'],
): GraphDebugSnapshot {
  const pass = SNAPSHOT.batches[0].passes[0];
  const bundleStatus =
    status === 'first-capture'
      ? 'first-capture'
      : status === 'rebuilt'
        ? 'recorded'
        : status === 'dynamic'
          ? 'not-used'
          : 'reused';
  return {
    ...SNAPSHOT,
    captureId,
    batches: [
      {
        ...SNAPSHOT.batches[0],
        passes: [
          {
            ...pass,
            drawBuild: {
              ...pass.drawBuild,
              status,
              causes: status === 'rebuilt' ? pass.drawBuild.causes : [],
            },
            bundle: {
              ...pass.bundle,
              status: bundleStatus,
              bundleDirtyId: bundleStatus === 'not-used' ? null : captureId,
              lastBundleDirtyId: bundleStatus === 'not-used' ? null : captureId,
              causes:
                bundleStatus === 'recorded'
                  ? [{ code: 'draws-rebuilt' }]
                  : bundleStatus === 'first-capture'
                    ? [{ code: 'first-capture' }]
                    : [],
            },
          },
        ],
      },
    ],
  };
}

function snapshotWithGeometry(captureId: number, geometryId: number): GraphDebugSnapshot {
  return {
    ...SNAPSHOT,
    captureId,
    geometries: [{ ...SNAPSHOT.geometries[0], id: geometryId }],
  };
}

function snapshotWithBundleStatus(
  captureId: number,
  status: GraphDebugSnapshot['batches'][number]['passes'][number]['bundle']['status'],
): GraphDebugSnapshot {
  const snapshot = snapshotWithStatus(captureId, 'reused');
  const batch = snapshot.batches[0];
  const pass = batch.passes[0];
  return {
    ...snapshot,
    batches: [
      {
        ...batch,
        passes: [
          {
            ...pass,
            bundle: {
              status,
              bundleDirtyId: captureId,
              lastBundleDirtyId: status === 'invalidated' ? captureId - 1 : captureId,
              causes: status === 'recorded' || status === 'invalidated' ? [{ code: 'bundle-only-change' }] : [],
            },
          },
        ],
      },
    ],
  };
}

function snapshotWithDrawnInstances(drawnInstanceCount: number): GraphDebugSnapshot {
  const batch = SNAPSHOT.batches[0];
  const pass = batch.passes[0];
  const draw = pass.draws[0];
  return {
    ...SNAPSHOT,
    summary: { ...SNAPSHOT.summary, drawnInstanceCount },
    batches: [
      {
        ...batch,
        drawnInstanceCount,
        passes: [
          {
            ...pass,
            drawnInstanceCount,
            draws: [
              {
                ...draw,
                drawnInstanceCount,
                drawnTriangleCount: 0,
              },
            ],
          },
        ],
      },
    ],
  };
}

const SNAPSHOT: GraphDebugSnapshot = {
  version: 4,
  captureId: 3,
  graph: {
    passes: [
      {
        name: 'opaque',
        description: 'Draws opaque scene geometry into scene color and depth.',
        sceneWorkload: 'forward',
        active: true,
        passIdx: 0,
        isAnchored: true,
        mipmapHandles: [],
        dependsOn: [],
        accesses: [
          {
            mode: 'write_attachment',
            handleId: 0,
            handleKind: 'color',
            effectiveLoadOp: 'clear',
          },
        ],
        acquires: [],
        releases: [],
      },
    ],
    resources: [
      {
        id: 0,
        kind: 'imported',
        type: 'color',
        isDefaultColor: true,
        isDefaultDepth: false,
        firstUse: null,
        lastUse: null,
      },
    ],
  },
  summary: {
    batchCount: 1,
    meshCount: 2,
    submittedMeshCount: 2,
    geometryCount: 1,
    materialCount: 1,
    textureCount: 1,
    drawCallCount: 1,
    sourceInstanceCount: 2,
    drawnInstanceCount: 2,
  },
  batches: [
    {
      id: 50,
      label: 'scene',
      slotCount: 2,
      meshCount: 2,
      submittedMeshCount: 2,
      geometryCount: 1,
      materialCount: 1,
      textureCount: 1,
      drawCallCount: 1,
      sourceInstanceCount: 2,
      drawnInstanceCount: 2,
      passes: [
        {
          name: 'opaque',
          bit: 2,
          renderableCount: 2,
          drawCallCount: 1,
          sourceInstanceCount: 2,
          drawnInstanceCount: 2,
          drawBuild: {
            status: 'rebuilt',
            commandListDirtyId: 4,
            causes: [{ code: 'material-changed', meshIds: [1] }],
          },
          bundle: {
            status: 'recorded',
            bundleDirtyId: 4,
            lastBundleDirtyId: 4,
            causes: [{ code: 'draws-rebuilt' }],
          },
          draws: [
            {
              index: 0,
              sourceMeshIds: [1, 2],
              geometryIds: [10],
              materialIds: [20],
              textureIds: [30],
              renderGeometryId: 10,
              topology: 'triangle-list',
              indexCount: 6,
              firstIndex: 0,
              baseVertex: 0,
              firstInstance: 0,
              sourceInstanceCount: 2,
              drawnInstanceCount: 2,
              drawnInstanceCountStatus: 'cpu-mirror',
              sourceTriangleCount: 4,
              drawnTriangleCount: 4,
            },
          ],
        },
      ],
    },
  ],
  meshes: [
    { id: 1, label: 'Car', type: 'Mesh3D', geometryId: 10, materialId: 20, visible: true },
    { id: 2, label: null, type: 'Mesh3D', geometryId: 10, materialId: 20, visible: true },
  ],
  geometries: [
    { id: 10, type: 'Geometry3D', vertexCount: 4, indexCount: 6, topology: 'triangle-list', dynamic: false },
  ],
  materials: [
    {
      id: 20,
      type: 'Material3D',
      textures: [{ slot: 0, name: 'baseColorTexture', textureId: 30 }],
    },
  ],
  textures: [
    {
      id: 30,
      sourceId: 31,
      label: 'albedo',
      width: 256,
      height: 128,
      format: 'rgba8unorm',
      mipLevelCount: 4,
    },
  ],
};
