/* oxlint-disable no-restricted-globals -- HTML debug overlay: builds and mounts DOM elements, which DOMAdapter cannot */
import { definedProps } from 'pixi.js';
import type { RenderOptions, Renderer } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';
import type { View3D } from '../../scene/View3D';
import { GeometryThumbnailGenerator } from './GeometryThumbnailGenerator';
import { GraphDebugRecording } from './GraphDebugRecording';
import type { GraphDebugRecordedFrame } from './GraphDebugRecording';
import { RenderGraphDebugger } from './GraphDebugSnapshot';
import type {
  GraphDebugBatchPassSnapshot,
  GraphDebugBatchSnapshot,
  GraphDebugBundleSnapshot,
  GraphDebugDrawBuildSnapshot,
  GraphDebugDrawSnapshot,
  GraphDebugGeometrySnapshot,
  GraphDebugGraphSnapshot,
  GraphDebugPassSnapshot,
  GraphDebugSnapshot,
  RenderGraphDebugSource,
} from './GraphDebugSnapshot';

/**
 * Constructor options for {@link GraphDebugOverlay}
 * @example
 * ```ts
 * // A getter keeps the overlay pointed at whichever view is current
 * const overlay = new GraphDebugOverlay({ view: () => view3d, maxRecordedFrames: 600 });
 * ```
 * @category extras:debug
 * @advanced
 */
export interface GraphDebugOverlayOptions {
  /** The view to debug, given directly or through a getter evaluated on every capture */
  view: RenderGraphDebugSource;
  /**
   * Element the overlay attaches to
   * @default document.body
   */
  parent?: HTMLElement;
  /**
   * Most frames one recording keeps before it stops itself
   * @default GraphDebugRecording.defaultOptions.maxFrames
   */
  maxRecordedFrames?: number;
  /**
   * Whether {@link GraphDebugOverlay#refresh | refresh()} runs after each screen render of `renderer`; needs a
   * renderer to hook
   * @default true
   */
  autoUpdate?: boolean;
  /**
   * The renderer to follow, so every capture is the frame just drawn
   *
   * `refresh()` runs off the renderer's own render rather than a ticker, so it's right whichever ticker drives
   * the app, or none. Leave unset (or set `autoUpdate: false`) to call `refresh()` yourself, throttled or
   * outside a timed section.
   */
  renderer?: Renderer;
}

interface PassMetrics {
  batches: number;
  draws: number;
  triangles: number;
  drawBuild: GraphDebugDrawBuildSnapshot['status'] | 'empty';
  bundle: GraphDebugBundleSnapshot['status'] | 'empty';
}

type PassStatus = GraphDebugDrawBuildSnapshot['status'] | 'active' | 'no-draws' | 'skipped';
type ReviewView = 'render-graph' | 'workload';

interface GraphMetrics {
  activePasses: GraphDebugPassSnapshot[];
  importedResources: number;
  skippedPasses: number;
  transientResources: number;
}

interface BatchPassEntry {
  batch: GraphDebugBatchSnapshot;
  pass: GraphDebugBatchPassSnapshot;
}

const DRAW_BUILD_STATUS_LABELS: Record<PassStatus, string> = {
  active: 'active',
  dynamic: 'draws dynamic',
  'first-capture': 'baseline',
  'no-draws': 'no draws',
  rebuilt: 'draws rebuilt',
  reused: 'draws reused',
  skipped: 'skipped',
};

const BUNDLE_STATUS_LABELS: Record<GraphDebugBundleSnapshot['status'], string> = {
  'first-capture': 'bundle baseline',
  invalidated: 'bundle pending',
  'not-used': 'no bundle',
  recorded: 'bundle recorded',
  reused: 'bundle reused',
};

const CSS = `
.p3d-debug__toolbar{display:flex;align-items:center;gap:5px;margin-bottom:8px}
.p3d-debug__title{color:#9fd9ff;font-weight:700;flex:1;white-space:nowrap}
.p3d-debug__button{font:inherit;color:#dceeff;background:#263747;border:1px solid #46647d;border-radius:4px;padding:2px 7px;cursor:pointer}
.p3d-debug__button:hover{background:#30485c}.p3d-debug__button--active{color:#17191d;background:#9fd9ff;border-color:#9fd9ff}.p3d-debug__button--active:disabled{opacity:1;cursor:default}
.p3d-debug__button--recording{color:#fff;background:#8e2d3b;border-color:#e45d70}.p3d-debug__button--recording:hover{background:#a63849}
.p3d-debug__button:disabled{opacity:.35;cursor:default}
.p3d-debug__tabs{display:flex;gap:4px;flex:0 0 auto;margin-bottom:8px}.p3d-debug__tab{min-width:100px;text-align:center}
.p3d-debug__summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin-bottom:8px}
.p3d-debug__metric{background:rgba(255,255,255,.055);border-radius:4px;padding:5px 6px;min-width:0}
.p3d-debug__metric-value{display:block;color:#fff;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis}
.p3d-debug__metric-label{display:block;color:#8796a3;font-size:8px;text-transform:uppercase;letter-spacing:.05em}
.p3d-debug__row{display:flex;align-items:center;gap:6px}.p3d-debug__row--spread{justify-content:space-between}
.p3d-debug__pass-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p3d-debug__status{font-size:8px;font-weight:700;text-transform:uppercase;padding:1px 4px;border-radius:3px;white-space:nowrap}
.p3d-debug__status-group{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:3px}
.p3d-debug__status--rebuilt{color:#251a05;background:#ffbf5b}.p3d-debug__status--reused{color:#0d2514;background:#7ad27a}
.p3d-debug__status--dynamic{color:#c9bfd9;background:#3a3344}.p3d-debug__status--first-capture{color:#102434;background:#9fd9ff}.p3d-debug__status--active{color:#0d2514;background:#7ad27a}.p3d-debug__status--no-draws{color:#aaa;background:#444}.p3d-debug__status--skipped{color:#788691;background:#2b3035}
.p3d-debug__status--bundle-recorded{color:#21142f;background:#c79aff}.p3d-debug__status--bundle-reused{color:#a9b3bd;background:#343b43}.p3d-debug__status--bundle-invalidated{color:#30131e;background:#ff91b5}.p3d-debug__status--bundle-first-capture{color:#102434;background:#9fd9ff}.p3d-debug__status--bundle-not-used{color:#788691;background:#2b3035}
.p3d-debug__subtle{color:#8796a3;font-size:9px}
.p3d-debug__access{font-size:9px;margin-top:1px}
.p3d-debug__timeline{flex:0 0 auto;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:5px;padding:6px 8px;margin-bottom:8px}
.p3d-debug__timeline-head{display:flex;align-items:center;gap:6px}.p3d-debug__timeline-label{flex:1;text-align:center;color:#dceeff}
.p3d-debug__timeline-range{display:block;width:100%;margin:5px 0 2px;accent-color:#9fd9ff;cursor:ew-resize}
.p3d-debug__timeline-range:disabled{cursor:default;opacity:.7}.p3d-debug__timeline-markers{position:relative;height:4px;background:#303943;border-radius:2px;margin:0 2px}
.p3d-debug__timeline-marker{position:absolute;top:0;width:2px;height:4px;background:#ffbf5b}.p3d-debug__timeline-marker--bundle{background:#c79aff}.p3d-debug__timeline-marker--first{background:#9fd9ff}
.p3d-debug__recording-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#e45d70;box-shadow:0 0 7px #e45d70;margin-right:5px}
.p3d-debug__workspace{display:grid;grid-template-columns:210px minmax(390px,1.2fr) minmax(330px,1fr);gap:8px;flex:1;min-height:0}
.p3d-debug__panel{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:5px;overflow:auto;min-height:0}
.p3d-debug__panel-title{position:sticky;top:0;z-index:1;background:#181a20;color:#9fd9ff;font-weight:700;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.09)}
.p3d-debug__pass-button{display:block;width:100%;font:inherit;text-align:left;color:#ddd;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.055);padding:7px 8px;cursor:pointer}
.p3d-debug__pass-button:hover{background:rgba(255,255,255,.06)}.p3d-debug__pass-button--selected{background:rgba(80,160,220,.18);box-shadow:inset 2px 0 #9fd9ff}
.p3d-debug__pass-button--inactive{opacity:.4}.p3d-debug__pass-stats{display:block;color:#8796a3;font-size:9px;margin-top:2px}
.p3d-debug__pass-description{display:block;color:#aebbc6;font-size:9px;line-height:1.3;margin-top:4px}.p3d-debug__pass-button .p3d-debug__pass-description{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p3d-debug__batch-head,.p3d-debug__batch-row{display:grid;grid-template-columns:minmax(76px,1.4fr) 76px 76px 48px 44px 40px 40px 40px 58px;gap:4px;align-items:center;padding:6px 8px}
.p3d-debug__batch-head{position:sticky;top:32px;z-index:1;color:#8796a3;background:#181a20;font-size:8px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.09)}
.p3d-debug__batch-row{color:#ddd;border:0;border-bottom:1px solid rgba(255,255,255,.055);background:transparent;font:inherit;text-align:left;width:100%;cursor:pointer}
.p3d-debug__batch-row:hover{background:rgba(255,255,255,.055)}.p3d-debug__batch-row--selected{background:rgba(80,160,220,.15)}
.p3d-debug__cell-number{text-align:right;color:#dfefff}.p3d-debug__section{padding:8px;border-bottom:1px solid rgba(255,255,255,.08)}
.p3d-debug__section-title{color:#9fd9ff;font-weight:700;margin-bottom:5px}.p3d-debug__facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.p3d-debug__cause{padding:4px 6px;margin:3px 0;border-left:2px solid #ffbf5b;background:rgba(255,191,91,.08);color:#f2d49c}
.p3d-debug__cause--bundle{border-left-color:#c79aff;background:rgba(199,154,255,.08);color:#dcc7f7}
.p3d-debug__draw-row{display:grid;grid-template-columns:28px 78px 82px 45px 45px 1fr;gap:4px;align-items:center;width:100%;font:inherit;color:#ddd;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.055);padding:5px 2px;cursor:pointer;text-align:left}
.p3d-debug__draw-row:hover{background:rgba(255,255,255,.055)}.p3d-debug__draw-row--selected{background:rgba(80,160,220,.15)}
.p3d-debug__count-source{color:#8796a3}.p3d-debug__count-arrow{color:#66737f;padding:0 3px}.p3d-debug__count-drawn{color:#dfefff}
.p3d-debug__draw-details{padding:8px 8px 10px 12px;background:rgba(80,160,220,.055);border-left:2px solid #6fb5e3;border-bottom:1px solid rgba(255,255,255,.08)}
.p3d-debug__geometry-cell{display:flex;align-items:center;gap:3px;min-height:24px}.p3d-debug__geometry-mini{display:flex;align-items:center;justify-content:center;width:24px;height:24px;flex:0 0 24px;background:#141820;border:1px solid rgba(255,255,255,.08);border-radius:3px;overflow:hidden}.p3d-debug__geometry-mini canvas{display:block;width:24px;height:24px}.p3d-debug__geometry-more{color:#8796a3;font-size:9px}
.p3d-debug__resource{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.045)}.p3d-debug__resource:last-child{border-bottom:0}
.p3d-debug__geometry-card{display:flex;align-items:center;gap:8px;min-height:58px}.p3d-debug__geometry-thumbnail{display:flex;align-items:center;justify-content:center;width:56px;height:56px;flex:0 0 56px;background:#141820;border:1px solid rgba(255,255,255,.08);border-radius:4px;overflow:hidden}
.p3d-debug__geometry-thumbnail canvas{display:block;width:56px;height:56px}.p3d-debug__geometry-placeholder{color:#697783;font-size:9px;text-align:center;padding:4px}.p3d-debug__geometry-details{min-width:0}
.p3d-debug__resource-title{color:#e7f3ff}.p3d-debug__empty{color:#8796a3;padding:10px}.p3d-debug__copy-status{color:#7ad27a;font-size:9px}
.p3d-debug__idle{display:flex;flex-direction:column;gap:6px}.p3d-debug__idle .p3d-debug__toolbar{margin-bottom:0}
.p3d-debug__graph-view{display:flex;flex-direction:column;flex:1;min-height:0}.p3d-debug__graph-layout{display:grid;grid-template-columns:minmax(420px,1.35fr) minmax(360px,1fr);gap:8px;flex:1;min-height:0}
.p3d-debug__graph-pass{padding:8px;border-bottom:1px solid rgba(255,255,255,.065)}.p3d-debug__graph-pass:last-child{border-bottom:0}.p3d-debug__graph-pass--skipped{opacity:.45}
.p3d-debug__graph-pass-index{color:#66737f;min-width:24px}.p3d-debug__graph-kind{color:#8796a3;font-size:8px;text-transform:uppercase;letter-spacing:.05em}
.p3d-debug__graph-links{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}.p3d-debug__graph-link{color:#b9c7d2;background:rgba(255,255,255,.055);border-radius:3px;padding:2px 5px;font-size:9px}.p3d-debug__graph-link--skipped{color:#788691;text-decoration:line-through}.p3d-debug__graph-anchor{color:#ffcc66;background:rgba(255,204,102,.1);border-radius:3px;padding:1px 4px;font-size:8px;text-transform:uppercase}
.p3d-debug__graph-events{color:#8796a3;font-size:9px;margin-top:4px}.p3d-debug__resource-head,.p3d-debug__resource-row{display:grid;grid-template-columns:minmax(100px,1fr) 62px 58px minmax(120px,1.4fr);gap:6px;align-items:center;padding:6px 8px}
.p3d-debug__resource-head{position:sticky;top:32px;z-index:1;color:#8796a3;background:#181a20;font-size:8px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.09)}.p3d-debug__resource-row{border-bottom:1px solid rgba(255,255,255,.055)}
.p3d-debug__lifetime{position:relative;height:8px;background:#2d343d;border-radius:4px;overflow:hidden}.p3d-debug__lifetime-bar{position:absolute;top:0;height:100%;min-width:2px;background:#6fb5e3;border-radius:4px}.p3d-debug__lifetime-external{color:#8796a3;font-size:9px}
`;

/**
 * HTML panel for recording a view's frames and reviewing how each one was drawn
 *
 * Press Record, use the app, then Stop. The review steps through the recorded frames in two tabs:
 * Workload lists each scene pass's batches and draws, and why draws were rebuilt or WebGPU
 * bundles re-recorded; Render Graph lists the graph's passes, their dependencies and the
 * lifetime of each resource. Copy Frame and Copy Recording put the data on the clipboard as
 * JSON.
 *
 * Nothing is captured outside a recording. Until one starts, the overlay adds nothing to the
 * renderer but the `postrender` listener that runs {@link GraphDebugOverlay#refresh | refresh()}.
 * @example
 * ```ts
 * const overlay = new GraphDebugOverlay({ view: view3d, renderer: app.renderer });
 * ```
 * @category extras:debug
 * @advanced
 */
export class GraphDebugOverlay {
  /**
   * Default {@link GraphDebugOverlayOptions} merged under every constructor call
   *
   * `new GraphDebugOverlay(opts)` resolves as `{ ...GraphDebugOverlay.defaultOptions, ...opts }`. Mutate to change
   * defaults process-wide.
   * @example
   * ```ts
   * GraphDebugOverlay.defaultOptions.maxRecordedFrames = 600;
   * ```
   */
  public static defaultOptions: Partial<Omit<GraphDebugOverlayOptions, 'view' | 'renderer'>> = {
    autoUpdate: true,
  };

  private readonly _getView: () => View3D | null | undefined;
  private readonly _container: HTMLDivElement;
  private readonly _style = document.createElement('style');
  private readonly _debugger: RenderGraphDebugger;
  private readonly _geometryThumbnails = new GeometryThumbnailGenerator();
  private readonly _captureGeometry = (geometry: Geometry3D): void => {
    this._geometryThumbnails.getThumbnail(geometry);
  };
  private readonly _recording: GraphDebugRecording;
  private _snapshot: GraphDebugSnapshot | null = null;
  private _collapsed = false;
  private _reviewView: ReviewView = 'workload';
  private _selectedPass: string | null = null;
  private _selectedBatch: number | null = null;
  private _selectedDraw: number | null = null;
  private _selectedFrame: number | null = null;
  private _copyStatus = '';
  private _autoUpdate = false;
  private _renderer: Renderer | null = null;
  private _hooked = false;
  private _destroyed = false;
  /**
   * Runner listener: pixi calls the method named after the runner on every object added to it
   *
   * Renders to a texture go through the same runner, so only a render to the screen counts as a
   * drawn frame.
   */
  private readonly _postrenderListener = {
    postrender: (options: RenderOptions): void => {
      if (options.target !== this._renderer!.view.renderTarget) return;
      this.refresh();
    },
  };

  /** @param options - Overlay options; see {@link GraphDebugOverlayOptions} */
  constructor(options: GraphDebugOverlayOptions) {
    const { view, parent, maxRecordedFrames, autoUpdate, renderer } = {
      ...GraphDebugOverlay.defaultOptions,
      ...definedProps(options),
    };

    this._getView = typeof view === 'function' ? view : () => view;
    this._debugger = new RenderGraphDebugger({ view: this._getView });
    this._recording = new GraphDebugRecording({ maxFrames: maxRecordedFrames });
    this._container = document.createElement('div');
    this._style.textContent = CSS;
    this._applyContainerStyle();
    (parent ?? document.body).appendChild(this._container);
    this._renderIdle(Boolean(this._getView()?._graph));
    this._autoUpdate = autoUpdate!;
    this.renderer = renderer ?? null;
  }

  /**
   * Whether {@link GraphDebugOverlay#refresh | refresh()} runs after each screen render of
   * {@link GraphDebugOverlay#renderer | renderer}
   *
   * Render-to-texture passes are skipped, so a recording only holds frames that were drawn.
   * @example
   * ```ts
   * const overlay = new GraphDebugOverlay({ view: () => view3d, renderer: app.renderer });
   *
   * overlay.autoUpdate = false; // pause; refresh() is yours to call until it's back on
   * ```
   */
  public get autoUpdate(): boolean {
    return this._autoUpdate;
  }

  /**
   * Installs or removes the renderer's `postrender` listener; has no effect once the overlay is destroyed
   * @param value - Whether to run `refresh()` after each screen render
   */
  public set autoUpdate(value: boolean) {
    this._autoUpdate = value;
    this._syncHook();
  }

  /**
   * The renderer whose screen renders run {@link GraphDebugOverlay#refresh | refresh()} while
   * {@link GraphDebugOverlay#autoUpdate | autoUpdate} is on; `null` leaves `refresh()` to the caller
   */
  public get renderer(): Renderer | null {
    return this._renderer;
  }

  /**
   * Moves the `postrender` listener to the new renderer; has no effect once the overlay is destroyed
   * @param value - The renderer to follow, or `null` to follow none
   */
  public set renderer(value: Renderer | null) {
    if (this._destroyed || value === this._renderer) return;

    this._renderer?.runners.postrender.remove(this._postrenderListener);
    this._hooked = false;
    this._renderer = value;
    this._syncHook();
  }

  /**
   * Captures the frame just rendered while a recording runs; outside one it only refreshes the
   * idle panel, which enables Record once the view has a render graph
   *
   * Runs after every screen render while {@link GraphDebugOverlay#autoUpdate | autoUpdate} is on
   * and a {@link GraphDebugOverlay#renderer | renderer} is set. Otherwise call it yourself after each
   * render.
   * @example
   * ```ts
   * const overlay = new GraphDebugOverlay({ view: view3d });
   *
   * app.ticker.add(() => overlay.refresh(), undefined, UPDATE_PRIORITY.UTILITY);
   * ```
   */
  public refresh(): void {
    if (!this._recording.active) {
      if (!this._snapshot) this._renderIdle(Boolean(this._getView()?._graph));
      return;
    }

    const view = this._getView();
    if (!view || !this._captureRecordingFrame()) return;
    if (this._recording.active) {
      const stop = this._container.querySelector('.p3d-debug__button--recording');
      if (stop) stop.textContent = `Stop · ${formatNumber(this._recording.frames.length)}`;
      return;
    }
    this._renderCurrent();
  }

  /** Stops following the renderer, removes the overlay from the DOM and drops all captured debug state */
  public destroy(): void {
    if (this._destroyed) return;

    this._destroyed = true;
    this._syncHook();
    this._renderer = null;
    this._debugger.reset();
    this._geometryThumbnails.clear();
    this._container.remove();
  }

  /** Installs or removes the postrender listener so it matches renderer, autoUpdate and destroyed */
  private _syncHook(): void {
    const want = Boolean(this._renderer) && this._autoUpdate && !this._destroyed;
    if (want === this._hooked) return;

    this._hooked = want;
    if (want) this._renderer!.runners.postrender.add(this._postrenderListener);
    else this._renderer?.runners.postrender.remove(this._postrenderListener);
  }

  private _applyContainerStyle(): void {
    const style = this._container.style;
    style.position = 'fixed';
    style.top = '8px';
    style.right = '8px';
    style.boxSizing = 'border-box';
    style.overflow = 'hidden';
    style.background = 'rgba(20, 20, 25, 0.96)';
    style.color = '#e6e6e6';
    style.font = '11px / 1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    style.padding = '8px 10px';
    style.border = '1px solid rgba(255,255,255,0.12)';
    style.borderRadius = '6px';
    style.zIndex = '9999';
    style.userSelect = 'text';
    style.boxShadow = '0 8px 32px rgba(0,0,0,.35)';
    this._applyModeStyle(false);
  }

  private _applyModeStyle(review: boolean): void {
    const style = this._container.style;
    if (review) {
      style.display = 'flex';
      style.flexDirection = 'column';
      style.left = '12px';
      style.right = '12px';
      style.bottom = '12px';
      style.width = 'auto';
      style.minWidth = '0';
      style.maxWidth = 'none';
      style.maxHeight = 'none';
      style.overflowY = 'hidden';
    } else {
      style.display = 'block';
      style.flexDirection = '';
      style.left = 'auto';
      style.bottom = 'auto';
      style.width = '230px';
      style.minWidth = '0';
      style.maxWidth = 'calc(100vw - 16px)';
      style.maxHeight = 'calc(100vh - 16px)';
      style.overflowY = 'auto';
    }
  }

  private _renderIdle(graphReady: boolean): void {
    const state = graphReady ? 'idle' : 'not-ready';
    if (this._container.dataset.debugState === state) return;

    const { shell: idle, toolbar } = this._beginShell(state);
    toolbar.appendChild(element('div', 'p3d-debug__title', 'RenderGraph Debugger'));
    const record = this._button('Record', () => this._startRecording());
    record.disabled = !graphReady;
    toolbar.appendChild(record);
    idle.appendChild(
      element(
        'div',
        'p3d-debug__subtle',
        graphReady ? 'Ready. No render data is captured until recording starts.' : 'RenderGraph — not yet initialised',
      ),
    );
  }

  private _renderCurrent(): void {
    if (this._recording.active) {
      this._renderRecording();
      return;
    }

    if (!this._snapshot) {
      this._renderIdle(Boolean(this._getView()?._graph));
      return;
    }

    if (this._collapsed) {
      this._renderCollapsed();
      return;
    }

    this._applyModeStyle(true);
    this._clear();
    this._container.dataset.debugState = 'snapshot';
    this._container.appendChild(this._renderToolbar(this._snapshot));
    this._container.appendChild(this._renderReviewTabs());
    const graphMetrics = this._reviewView === 'render-graph' ? this._graphMetrics(this._snapshot.graph) : undefined;
    if (this._recording.frames.length > 0) this._container.appendChild(this._renderTimeline(graphMetrics));
    if (this._reviewView === 'workload') {
      this._container.appendChild(this._renderSummary(this._snapshot));
      this._container.appendChild(this._renderWorkspace(this._snapshot));
    } else {
      this._container.appendChild(this._renderGraphView(this._snapshot, graphMetrics!));
    }
  }

  private _renderCollapsed(): void {
    const { toolbar } = this._beginShell('collapsed');
    this._container.style.width = 'auto';
    toolbar.appendChild(
      this._button('Open Debugger', () => {
        this._collapsed = false;
      }),
    );
  }

  private _renderRecording(): void {
    const { shell: recording, toolbar } = this._beginShell('recording');
    const title = element('div', 'p3d-debug__title');
    title.appendChild(element('span', 'p3d-debug__recording-dot'));
    title.appendChild(document.createTextNode('Recording'));
    toolbar.appendChild(title);
    const stop = this._button(`Stop · ${formatNumber(this._recording.frames.length)}`, () => this._stopRecording());
    stop.classList.add('p3d-debug__button--recording');
    toolbar.appendChild(stop);
    recording.appendChild(element('div', 'p3d-debug__subtle', 'Capturing every frame. Stop to review the recording.'));
  }

  private _beginShell(state: string): {
    /** Root panel element for the state's content */
    shell: HTMLDivElement;
    /** Header row the caller fills with title and buttons */
    toolbar: HTMLDivElement;
  } {
    this._applyModeStyle(false);
    this._clear();
    this._container.dataset.debugState = state;
    const shell = element('div', 'p3d-debug__idle');
    const toolbar = element('div', 'p3d-debug__toolbar');
    shell.appendChild(toolbar);
    this._container.appendChild(shell);
    return { shell, toolbar };
  }

  private _clear(): void {
    this._container.replaceChildren(this._style);
  }

  private _renderToolbar(snapshot: GraphDebugSnapshot): HTMLElement {
    const toolbar = element('div', 'p3d-debug__toolbar');
    toolbar.appendChild(
      element(
        'div',
        'p3d-debug__title',
        `${this._reviewView === 'workload' ? 'Workload' : 'Render Graph'} · Capture ${snapshot.captureId}`,
      ),
    );

    if (this._copyStatus) toolbar.appendChild(element('span', 'p3d-debug__copy-status', this._copyStatus));
    if (this._recording.frames.length > 0) {
      toolbar.appendChild(
        this._button('Copy Recording', () => this._copyJSON(this._recording.toJSON(), 'Recording copied')),
      );
    }
    toolbar.appendChild(this._button('Copy Frame', () => this._copyJSON(snapshot, 'Frame copied')));
    toolbar.appendChild(this._button('Record', () => this._startRecording()));
    toolbar.appendChild(
      this._button('Hide', () => {
        this._collapsed = true;
      }),
    );
    return toolbar;
  }

  private _renderReviewTabs(): HTMLElement {
    const tabs = element('div', 'p3d-debug__tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [view, label] of [
      ['workload', 'Workload'],
      ['render-graph', 'Render Graph'],
    ] as const) {
      const tab = this._button(label, () => {
        this._reviewView = view;
        this._copyStatus = '';
        if (view === 'workload') this._normalizeSelection();
      });
      tab.classList.add('p3d-debug__tab');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(this._reviewView === view));
      if (this._reviewView === view) {
        tab.classList.add('p3d-debug__button--active');
        tab.disabled = true;
      }
      tabs.appendChild(tab);
    }
    return tabs;
  }

  private _renderSummary(snapshot: GraphDebugSnapshot): HTMLElement {
    const summary = element('div', 'p3d-debug__summary');
    summary.appendChild(this._metric('Batches', snapshot.summary.batchCount));
    summary.appendChild(this._metric('Draws', snapshot.summary.drawCallCount));
    summary.appendChild(this._metric('Meshes', snapshot.summary.meshCount));
    summary.appendChild(
      this._metric(
        'Instances',
        snapshot.summary.drawnInstanceCount ?? `${formatNumber(snapshot.summary.sourceInstanceCount)} src`,
      ),
    );
    summary.appendChild(this._metric('Triangles', this._snapshotTriangles(snapshot)));
    return summary;
  }

  private _renderTimeline(graphMetrics?: GraphMetrics): HTMLElement {
    const frames = this._recording.frames;
    const lastIndex = frames.length - 1;
    const selectedIndex = this._selectedFrame ?? lastIndex;
    const selected = frames[selectedIndex];
    const timeline = element('div', 'p3d-debug__timeline');
    const head = element('div', 'p3d-debug__timeline-head');
    const workload = this._reviewView === 'workload';
    const previousIndex = workload ? this._findWorkChangeFrame(selectedIndex, -1) : selectedIndex - 1;
    let nextIndex = -1;
    if (workload) nextIndex = this._findWorkChangeFrame(selectedIndex, 1);
    else if (selectedIndex < lastIndex) nextIndex = selectedIndex + 1;
    const previous = this._button(workload ? '‹ Change' : '‹ Frame', () => this._selectRecordedFrame(previousIndex));
    const next = this._button(workload ? 'Change ›' : 'Frame ›', () => this._selectRecordedFrame(nextIndex));
    previous.disabled = previousIndex < 0;
    next.disabled = nextIndex < 0;
    head.appendChild(previous);

    const label = element('div', 'p3d-debug__timeline-label');
    const frameLabel =
      selectedIndex === 0 ? `Baseline · Frame 1/${frames.length}` : `Frame ${selectedIndex + 1}/${frames.length}`;
    const detail = workload
      ? this._workloadFrameDetail(selected)
      : `${graphMetrics!.activePasses.length}/${selected.snapshot.graph.passes.length} active · ${selected.snapshot.graph.resources.length} resources`;
    label.appendChild(document.createTextNode(`${frameLabel} · ${formatDuration(selected.elapsedMs)} · ${detail}`));
    head.appendChild(label);
    head.appendChild(next);
    timeline.appendChild(head);

    const range = element('input', 'p3d-debug__timeline-range');
    range.type = 'range';
    range.min = '0';
    range.max = String(lastIndex);
    range.step = '1';
    range.value = String(selectedIndex);
    range.disabled = frames.length < 2;
    range.setAttribute('aria-label', 'Recorded frame');
    range.onchange = () => {
      this._selectRecordedFrame(Number(range.value));
      this._renderCurrent();
    };
    range.onwheel = (event) => {
      if (frames.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY > 0 || event.deltaX > 0 ? 1 : -1;
      this._selectRecordedFrame(Math.max(0, Math.min(lastIndex, selectedIndex + direction)));
      this._renderCurrent();
    };
    timeline.appendChild(range);

    if (workload) {
      const markers = element('div', 'p3d-debug__timeline-markers');
      const denominator = Math.max(1, lastIndex);
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const drawRebuilt = frame.drawRebuiltBatchPassCount > 0;
        const bundleChanged = frame.bundleRecordedBatchPassCount > 0 || frame.bundleInvalidatedBatchPassCount > 0;
        if (!drawRebuilt && !bundleChanged && frame.firstCaptureBatchPassCount === 0) continue;
        const modifier = drawRebuilt
          ? ''
          : bundleChanged
            ? ' p3d-debug__timeline-marker--bundle'
            : ' p3d-debug__timeline-marker--first';
        const marker = element('span', `p3d-debug__timeline-marker${modifier}`);
        marker.style.left = `${(i / denominator) * 100}%`;
        const events: string[] = [];
        if (drawRebuilt) events.push(formatCount(frame.drawRebuiltBatchPassCount, 'draw rebuild'));
        if (frame.bundleRecordedBatchPassCount > 0)
          events.push(formatCount(frame.bundleRecordedBatchPassCount, 'bundle recording'));
        if (frame.bundleInvalidatedBatchPassCount > 0)
          events.push(formatCount(frame.bundleInvalidatedBatchPassCount, 'pending bundle'));
        marker.title = `Frame ${i + 1}: ${events.length > 0 ? events.join(' · ') : 'first capture'}`;
        markers.appendChild(marker);
      }
      timeline.appendChild(markers);
    }
    return timeline;
  }

  private _renderGraphView(snapshot: GraphDebugSnapshot, metrics: GraphMetrics): HTMLElement {
    const view = element('div', 'p3d-debug__graph-view');
    view.appendChild(this._renderGraphSummary(snapshot.graph, metrics));
    const layout = element('div', 'p3d-debug__graph-layout');
    layout.appendChild(this._renderGraphPasses(snapshot.graph));
    layout.appendChild(this._renderGraphResources(snapshot.graph, metrics.activePasses));
    view.appendChild(layout);
    return view;
  }

  private _renderGraphSummary(graph: GraphDebugGraphSnapshot, metrics: GraphMetrics): HTMLElement {
    const summary = element('div', 'p3d-debug__summary');
    summary.appendChild(this._metric('Active passes', metrics.activePasses.length));
    summary.appendChild(this._metric('Skipped passes', metrics.skippedPasses));
    summary.appendChild(this._metric('Resources', graph.resources.length));
    summary.appendChild(this._metric('Transient', metrics.transientResources));
    summary.appendChild(this._metric('Imported', metrics.importedResources));
    return summary;
  }

  private _graphMetrics(graph: GraphDebugGraphSnapshot): GraphMetrics {
    const activePasses = graph.passes.filter((pass) => pass.active);
    const transientResources = graph.resources.filter((resource) => resource.kind === 'transient').length;
    return {
      activePasses,
      importedResources: graph.resources.length - transientResources,
      skippedPasses: graph.passes.length - activePasses.length,
      transientResources,
    };
  }

  private _renderGraphPasses(graph: GraphDebugGraphSnapshot): HTMLElement {
    const panel = element('div', 'p3d-debug__panel');
    panel.appendChild(element('div', 'p3d-debug__panel-title', 'Declared Passes & Dependencies'));
    for (let i = 0; i < graph.passes.length; i++) {
      const pass = graph.passes[i];
      const card = element('div', `p3d-debug__graph-pass${pass.active ? '' : ' p3d-debug__graph-pass--skipped'}`);
      const title = element('div', 'p3d-debug__row p3d-debug__row--spread');
      const identity = element('div', 'p3d-debug__row');
      const declaredIndex = element('span', 'p3d-debug__graph-pass-index', `D${i}`);
      declaredIndex.title = 'Declaration order';
      identity.appendChild(declaredIndex);
      const executionIndex = element('span', 'p3d-debug__graph-pass-index', `E${pass.passIdx ?? '—'}`);
      executionIndex.title = 'Active execution order';
      identity.appendChild(executionIndex);
      identity.appendChild(element('span', 'p3d-debug__pass-name', pass.name));
      identity.appendChild(
        element(
          'span',
          'p3d-debug__graph-kind',
          pass.sceneWorkload === null ? 'graph operation' : `${pass.sceneWorkload} scene`,
        ),
      );
      if (pass.isAnchored) identity.appendChild(element('span', 'p3d-debug__graph-anchor', 'anchored output'));
      if (pass.mipmapHandles.length > 0)
        identity.appendChild(element('span', 'p3d-debug__graph-anchor', 'generates mipmaps'));
      title.appendChild(identity);
      title.appendChild(this._status(pass.active ? 'active' : 'skipped'));
      card.appendChild(title);
      if (pass.description) card.appendChild(element('div', 'p3d-debug__pass-description', pass.description));

      const links = element('div', 'p3d-debug__graph-links');
      if (pass.dependsOn.length === 0) {
        links.appendChild(element('span', 'p3d-debug__graph-link', 'no dependencies'));
      } else {
        for (let d = 0; d < pass.dependsOn.length; d++) {
          const dependency = graph.passes[pass.dependsOn[d]];
          const state = dependency?.active ? 'active' : 'skipped';
          links.appendChild(
            element(
              'span',
              `p3d-debug__graph-link${state === 'skipped' ? ' p3d-debug__graph-link--skipped' : ''}`,
              `← ${dependency?.name ?? '?'} · ${state}`,
            ),
          );
        }
      }
      card.appendChild(links);

      for (let a = 0; a < pass.accesses.length; a++) card.appendChild(this._renderAccessLine(graph, pass.accesses[a]));
      for (const [label, resourceIds] of [
        ['Acquire', pass.acquires],
        ['Release', pass.releases],
      ] as const) {
        if (resourceIds.length > 0) {
          card.appendChild(
            element(
              'div',
              'p3d-debug__graph-events',
              `${label}: ${resourceIds.map((id) => this._resourceName(graph, id)).join(', ')}`,
            ),
          );
        }
      }
      panel.appendChild(card);
    }
    return panel;
  }

  private _renderGraphResources(graph: GraphDebugGraphSnapshot, activePasses: GraphDebugPassSnapshot[]): HTMLElement {
    const panel = element('div', 'p3d-debug__panel');
    panel.appendChild(element('div', 'p3d-debug__panel-title', 'Resource Lifetimes'));
    const header = element('div', 'p3d-debug__resource-head');
    for (const label of ['Resource', 'Kind', 'Type', 'Lifetime']) header.appendChild(element('span', '', label));
    panel.appendChild(header);

    const passCount = Math.max(1, activePasses.length);
    for (let i = 0; i < graph.resources.length; i++) {
      const resource = graph.resources[i];
      const row = element('div', 'p3d-debug__resource-row');
      row.appendChild(element('span', 'p3d-debug__resource-title', this._resourceName(graph, resource.id)));
      row.appendChild(element('span', 'p3d-debug__subtle', resource.kind));
      row.appendChild(element('span', 'p3d-debug__subtle', resource.type));
      if (resource.firstUse === null || resource.lastUse === null) {
        row.appendChild(
          element(
            'span',
            'p3d-debug__lifetime-external',
            resource.kind === 'imported' ? 'external' : 'unused this frame',
          ),
        );
      } else {
        const lifetime = element('span', 'p3d-debug__lifetime');
        const firstPass = activePasses[resource.firstUse]?.name ?? `active pass ${resource.firstUse}`;
        const lastPass = activePasses[resource.lastUse]?.name ?? `active pass ${resource.lastUse}`;
        lifetime.title = `${firstPass} → ${lastPass}`;
        const bar = element('span', 'p3d-debug__lifetime-bar');
        bar.style.left = `${(resource.firstUse / passCount) * 100}%`;
        bar.style.width = `${((resource.lastUse - resource.firstUse + 1) / passCount) * 100}%`;
        lifetime.appendChild(bar);
        row.appendChild(lifetime);
      }
      panel.appendChild(row);
    }
    return panel;
  }

  private _renderWorkspace(snapshot: GraphDebugSnapshot): HTMLElement {
    const workspace = element('div', 'p3d-debug__workspace');
    workspace.appendChild(this._renderPassList(snapshot));
    workspace.appendChild(this._renderBatchTable(snapshot));
    workspace.appendChild(this._renderInspector(snapshot));
    return workspace;
  }

  private _renderPassList(snapshot: GraphDebugSnapshot): HTMLElement {
    const panel = element('div', 'p3d-debug__panel');
    panel.appendChild(element('div', 'p3d-debug__panel-title', 'Scene Passes'));
    const passes = this._workloadPasses(snapshot);
    if (passes.length === 0) {
      panel.appendChild(element('div', 'p3d-debug__empty', 'No forward or shadow scene passes in this frame.'));
      return panel;
    }

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const metrics = this._passMetrics(snapshot, pass.name);
      const button = element(
        'button',
        `p3d-debug__pass-button${pass.name === this._selectedPass ? ' p3d-debug__pass-button--selected' : ''}${pass.active ? '' : ' p3d-debug__pass-button--inactive'}`,
      );
      button.type = 'button';
      button.appendChild(element('span', 'p3d-debug__row p3d-debug__row--spread'));
      const title = button.firstElementChild!;
      title.appendChild(element('span', 'p3d-debug__pass-name', pass.name));
      const statuses = element('span', 'p3d-debug__status-group');
      statuses.appendChild(this._drawBuildStatus(this._workloadStatus(pass, metrics)));
      if (metrics.bundle !== 'empty' && metrics.bundle !== 'not-used') {
        statuses.appendChild(this._bundleStatus(metrics.bundle));
      }
      title.appendChild(statuses);
      if (pass.description) {
        const description = element('span', 'p3d-debug__pass-description', pass.description);
        description.title = pass.description;
        button.appendChild(description);
      }
      button.appendChild(
        element(
          'span',
          'p3d-debug__pass-stats',
          `${formatCount(metrics.batches, 'batch', 'batches')} · ${formatCount(metrics.draws, 'draw')} · ${formatNumber(metrics.triangles)} tris`,
        ),
      );
      button.onpointerdown = (event) => {
        if (event.button !== 0) return;
        this._selectedPass = pass.name;
        this._selectedBatch = null;
        this._selectedDraw = null;
        this._normalizeSelection();
        this._renderCurrent();
      };
      panel.appendChild(button);
    }
    return panel;
  }

  private _renderBatchTable(snapshot: GraphDebugSnapshot): HTMLElement {
    const panel = element('div', 'p3d-debug__panel');
    const pass = snapshot.graph.passes.find((item) => item.name === this._selectedPass);
    panel.appendChild(element('div', 'p3d-debug__panel-title', pass ? `${pass.name} batches` : 'Batches'));
    const entries = this._selectedPass ? this._batchPasses(snapshot, this._selectedPass) : [];
    if (entries.length === 0) {
      panel.appendChild(element('div', 'p3d-debug__empty', 'No retained mesh batches for this pass.'));
      return panel;
    }

    const header = element('div', 'p3d-debug__batch-head');
    for (const name of ['Batch', 'Draw cache', 'Bundle', 'Mesh', 'Draw', 'Geo', 'Mat', 'Tex', 'Tris']) {
      header.appendChild(
        element(
          'span',
          name === 'Batch' || name === 'Draw cache' || name === 'Bundle' ? '' : 'p3d-debug__cell-number',
          name,
        ),
      );
    }
    panel.appendChild(header);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const row = element(
        'button',
        `p3d-debug__batch-row${entry.batch.id === this._selectedBatch ? ' p3d-debug__batch-row--selected' : ''}`,
      );
      row.type = 'button';
      row.appendChild(element('span', '', entry.batch.label));
      row.appendChild(this._drawBuildStatus(entry.pass.drawBuild.status));
      row.appendChild(
        entry.pass.bundle.status === 'not-used'
          ? element('span', 'p3d-debug__subtle', '—')
          : this._bundleStatus(entry.pass.bundle.status),
      );
      row.appendChild(element('span', 'p3d-debug__cell-number', formatNumber(entry.pass.renderableCount)));
      row.appendChild(element('span', 'p3d-debug__cell-number', formatNumber(entry.pass.drawCallCount)));
      const resources = this._passResourceCounts(entry.pass);
      row.appendChild(element('span', 'p3d-debug__cell-number', formatNumber(resources.geometries)));
      row.appendChild(element('span', 'p3d-debug__cell-number', formatNumber(resources.materials)));
      row.appendChild(element('span', 'p3d-debug__cell-number', formatNumber(resources.textures)));
      row.appendChild(element('span', 'p3d-debug__cell-number', formatNumber(this._passTriangles(entry.pass))));
      row.onpointerdown = (event) => {
        if (event.button !== 0) return;
        this._selectedBatch = entry.batch.id;
        this._selectedDraw = null;
        this._renderCurrent();
      };
      panel.appendChild(row);
    }
    return panel;
  }

  private _renderInspector(snapshot: GraphDebugSnapshot): HTMLElement {
    const panel = element('div', 'p3d-debug__panel');
    panel.appendChild(element('div', 'p3d-debug__panel-title', 'Inspector'));
    const entry = this._selectedPass
      ? this._batchPasses(snapshot, this._selectedPass).find((item) => item.batch.id === this._selectedBatch)
      : undefined;
    if (!entry) {
      const pass = snapshot.graph.passes.find((item) => item.name === this._selectedPass);
      const message = pass?.active ? 'No scene draws were submitted for this pass.' : 'Pass skipped this frame.';
      panel.appendChild(element('div', 'p3d-debug__empty', this._selectedPass ? message : 'Select a draw pass.'));
      return panel;
    }

    panel.appendChild(this._renderBatchSummary(snapshot, entry));
    panel.appendChild(this._renderDrawBuildCauses(entry.pass.drawBuild));
    panel.appendChild(this._renderBundleDetails(entry.pass.bundle));
    panel.appendChild(this._renderDrawList(snapshot, entry.pass));
    return panel;
  }

  private _renderBatchSummary(snapshot: GraphDebugSnapshot, entry: BatchPassEntry): HTMLElement {
    const section = element('div', 'p3d-debug__section');
    const title = element('div', 'p3d-debug__row p3d-debug__row--spread');
    title.appendChild(element('div', 'p3d-debug__section-title', `${entry.batch.label} · ${entry.pass.name}`));
    const statuses = element('div', 'p3d-debug__status-group');
    statuses.appendChild(this._drawBuildStatus(entry.pass.drawBuild.status));
    if (entry.pass.bundle.status !== 'not-used') statuses.appendChild(this._bundleStatus(entry.pass.bundle.status));
    title.appendChild(statuses);
    section.appendChild(title);
    const pass = snapshot.graph.passes.find((item) => item.name === entry.pass.name);
    if (pass?.description) section.appendChild(element('div', 'p3d-debug__pass-description', pass.description));
    const facts = element('div', 'p3d-debug__facts');
    const resources = this._passResourceCounts(entry.pass);
    facts.appendChild(this._metric('Meshes', entry.pass.renderableCount));
    facts.appendChild(this._metric('Draws', entry.pass.drawCallCount));
    facts.appendChild(
      this._metric('Instances', entry.pass.drawnInstanceCount ?? `${formatNumber(entry.pass.sourceInstanceCount)} src`),
    );
    facts.appendChild(this._metric('Geometries', resources.geometries));
    facts.appendChild(this._metric('Materials', resources.materials));
    facts.appendChild(this._metric('Textures', resources.textures));
    section.appendChild(facts);
    return section;
  }

  private _renderDrawBuildCauses(drawBuild: GraphDebugDrawBuildSnapshot): HTMLElement {
    const section = element('div', 'p3d-debug__section');
    section.appendChild(element('div', 'p3d-debug__section-title', 'Draw rebuild causes'));
    if (drawBuild.status === 'dynamic') {
      section.appendChild(element('div', 'p3d-debug__subtle', 'Regenerated every frame by pass policy.'));
      return section;
    }
    if (drawBuild.causes.length === 0) {
      section.appendChild(element('div', 'p3d-debug__subtle', 'Draw command list reused without rebuilding.'));
      return section;
    }
    for (let i = 0; i < drawBuild.causes.length; i++) {
      const cause = drawBuild.causes[i];
      let detail = humanize(cause.code);
      if (cause.meshIds?.length) detail += ` · meshes ${limitedIds(cause.meshIds)}`;
      if (cause.previous !== undefined && cause.current !== undefined)
        detail += ` · ${cause.previous} → ${cause.current}`;
      section.appendChild(element('div', 'p3d-debug__cause', detail));
    }
    return section;
  }

  private _renderBundleDetails(bundle: GraphDebugBundleSnapshot): HTMLElement {
    const section = element('div', 'p3d-debug__section');
    section.appendChild(element('div', 'p3d-debug__section-title', 'WebGPU bundle'));
    if (bundle.status === 'not-used') {
      section.appendChild(element('div', 'p3d-debug__subtle', 'No WebGPU render bundle is used by this pass.'));
      return section;
    }
    if (bundle.status === 'first-capture') {
      section.appendChild(element('div', 'p3d-debug__subtle', 'Baseline captured; prior bundle activity is unknown.'));
      return section;
    }
    if (bundle.status === 'reused') {
      section.appendChild(element('div', 'p3d-debug__subtle', 'Recorded bundle reused without re-encoding.'));
      return section;
    }

    const cause = bundle.causes[0]?.code;
    let detail =
      cause === 'draws-rebuilt'
        ? 'The draw rebuild required a fresh bundle recording.'
        : 'Draw data was reused; bundle-only GPU state changed.';
    if (bundle.status === 'invalidated') detail += ' The bundle was still pending when this snapshot was captured.';
    section.appendChild(element('div', 'p3d-debug__cause p3d-debug__cause--bundle', detail));
    return section;
  }

  private _renderDrawList(snapshot: GraphDebugSnapshot, pass: GraphDebugBatchPassSnapshot): HTMLElement {
    const section = element('div', 'p3d-debug__section');
    section.appendChild(element('div', 'p3d-debug__section-title', `Draw calls · ${pass.draws.length}`));
    if (pass.draws.length === 0) {
      section.appendChild(element('div', 'p3d-debug__subtle', 'No retained draw commands.'));
      return section;
    }
    const header = element('div', 'p3d-debug__draw-row p3d-debug__subtle');
    for (const name of ['#', 'Inst', 'Tris', 'Mat', 'Tex', 'Geometry']) {
      const cell = element('span', '', name);
      if (name === 'Inst') cell.title = 'Source instances → drawn instances when culling changes the count';
      if (name === 'Tris') cell.title = 'Source triangles → drawn triangles when culling changes the count';
      header.appendChild(cell);
    }
    section.appendChild(header);
    for (let i = 0; i < pass.draws.length; i++) {
      const draw = pass.draws[i];
      const selected = draw.index === this._selectedDraw;
      const row = element('button', `p3d-debug__draw-row${selected ? ' p3d-debug__draw-row--selected' : ''}`);
      row.type = 'button';
      row.setAttribute('aria-expanded', String(selected));
      row.appendChild(element('span', '', `${selected ? '▾' : '▸'} ${draw.index}`));
      const instanceCell = element('span');
      if (draw.drawnInstanceCount === null) {
        instanceCell.textContent = `${formatNumber(draw.sourceInstanceCount)}*`;
      } else if (draw.drawnInstanceCount !== draw.sourceInstanceCount) {
        instanceCell.title = 'Source instances → drawn instances';
        instanceCell.appendChild(element('span', 'p3d-debug__count-source', formatNumber(draw.sourceInstanceCount)));
        instanceCell.appendChild(element('span', 'p3d-debug__count-arrow', '→'));
        instanceCell.appendChild(element('span', 'p3d-debug__count-drawn', formatNumber(draw.drawnInstanceCount)));
      } else {
        instanceCell.textContent = formatNumber(draw.drawnInstanceCount);
      }
      row.appendChild(instanceCell);
      const triangleCell = element('span');
      if (
        draw.sourceTriangleCount !== null &&
        draw.drawnTriangleCount !== null &&
        draw.drawnTriangleCount !== draw.sourceTriangleCount
      ) {
        triangleCell.title = 'Source triangles → drawn triangles';
        triangleCell.appendChild(element('span', 'p3d-debug__count-source', formatNumber(draw.sourceTriangleCount)));
        triangleCell.appendChild(element('span', 'p3d-debug__count-arrow', '→'));
        triangleCell.appendChild(element('span', 'p3d-debug__count-drawn', formatNumber(draw.drawnTriangleCount)));
      } else {
        triangleCell.textContent = formatNumber(draw.drawnTriangleCount ?? draw.sourceTriangleCount ?? 0);
      }
      row.appendChild(triangleCell);
      row.appendChild(element('span', '', String(draw.materialIds.length)));
      row.appendChild(element('span', '', String(draw.textureIds.length)));
      const geometries = draw.geometryIds
        .map((id) => snapshot.geometries.find((geometry) => geometry.id === id))
        .filter(isDefined);
      const geometryCell = element('span', 'p3d-debug__geometry-cell');
      const shownGeometries = geometries.slice(0, 3);
      for (let g = 0; g < shownGeometries.length; g++) {
        geometryCell.appendChild(this._renderGeometryThumbnail(shownGeometries[g], true));
      }
      if (geometries.length > shownGeometries.length) {
        geometryCell.appendChild(
          element('span', 'p3d-debug__geometry-more', `+${geometries.length - shownGeometries.length}`),
        );
      }
      row.appendChild(geometryCell);
      row.onpointerdown = (event) => {
        if (event.button !== 0) return;
        const inspector = row.closest('.p3d-debug__panel') as HTMLElement | null;
        const scrollTop = inspector?.scrollTop ?? 0;
        this._selectedDraw = selected ? null : draw.index;
        this._renderCurrent();
        const updatedInspector = this._container.querySelectorAll<HTMLElement>('.p3d-debug__panel')[2];
        if (updatedInspector) updatedInspector.scrollTop = scrollTop;
      };
      section.appendChild(row);
      if (selected) section.appendChild(this._renderDrawInspector(snapshot, draw));
    }
    if (pass.draws.some((draw) => draw.drawnInstanceCount === null)) {
      section.appendChild(element('div', 'p3d-debug__subtle', '* GPU-cull survivor count requires readback.'));
    }
    if (pass.draws.some((draw) => draw.drawnInstanceCountStatus === 'cpu-mirror')) {
      section.appendChild(element('div', 'p3d-debug__subtle', 'GPU-cull survivor counts mirrored on CPU.'));
    }
    return section;
  }

  private _renderDrawInspector(snapshot: GraphDebugSnapshot, draw: GraphDebugDrawSnapshot): HTMLElement {
    const section = element('div', 'p3d-debug__draw-details');
    section.appendChild(
      element(
        'div',
        'p3d-debug__subtle',
        `${draw.topology} · ${draw.indexCount} indices · first ${draw.firstIndex} · base vertex ${draw.baseVertex}`,
      ),
    );

    const shownMeshIds = draw.sourceMeshIds.slice(0, 50);
    const meshes = shownMeshIds.map((id) => snapshot.meshes.find((mesh) => mesh.id === id)).filter(isDefined);
    if (meshes.length > 0) {
      section.appendChild(element('div', 'p3d-debug__resource-title', `Meshes · ${draw.sourceMeshIds.length}`));
      for (const mesh of meshes) {
        section.appendChild(element('div', 'p3d-debug__resource', `${mesh.label ?? mesh.type} #${mesh.id}`));
      }
      if (draw.sourceMeshIds.length > shownMeshIds.length) {
        section.appendChild(
          element('div', 'p3d-debug__subtle', `…and ${draw.sourceMeshIds.length - shownMeshIds.length} more meshes`),
        );
      }
    }

    for (const materialId of draw.materialIds) {
      const material = snapshot.materials.find((item) => item.id === materialId);
      if (!material) continue;
      const resource = element('div', 'p3d-debug__resource');
      resource.appendChild(element('div', 'p3d-debug__resource-title', `${material.type} #${material.id}`));
      for (const binding of material.textures) {
        const texture = snapshot.textures.find((item) => item.id === binding.textureId);
        resource.appendChild(
          element(
            'div',
            'p3d-debug__subtle',
            `${binding.name ?? `slot ${binding.slot}`} → ${texture?.label ?? `texture ${binding.textureId}`}${texture ? ` · ${texture.width}×${texture.height} ${texture.format ?? ''} · ${texture.mipLevelCount} mips` : ''}`,
          ),
        );
      }
      section.appendChild(resource);
    }

    for (const geometryId of draw.geometryIds) {
      const geometry = snapshot.geometries.find((item) => item.id === geometryId);
      if (!geometry) continue;
      section.appendChild(this._renderGeometryCard(geometry));
    }
    return section;
  }

  private _renderGeometryCard(geometry: GraphDebugGeometrySnapshot): HTMLElement {
    const card = element('div', 'p3d-debug__resource p3d-debug__geometry-card');
    card.appendChild(this._renderGeometryThumbnail(geometry, false));

    const details = element('div', 'p3d-debug__geometry-details');
    details.appendChild(element('div', 'p3d-debug__resource-title', `${geometry.type} #${geometry.id}`));
    details.appendChild(
      element(
        'div',
        'p3d-debug__subtle',
        `${formatNumber(geometry.vertexCount)} vertices · ${formatNumber(geometry.indexCount)} indices`,
      ),
    );
    details.appendChild(
      element('div', 'p3d-debug__subtle', `${humanize(geometry.topology)}${geometry.dynamic ? ' · dynamic' : ''}`),
    );
    card.appendChild(details);
    return card;
  }

  private _renderGeometryThumbnail(geometry: GraphDebugGeometrySnapshot, compact: boolean): HTMLElement {
    const thumbnail = element('div', compact ? 'p3d-debug__geometry-mini' : 'p3d-debug__geometry-thumbnail');
    thumbnail.title = geometry.type;
    const result = this._geometryThumbnails.getThumbnailById(geometry.id);
    if (result) {
      if (result.status === 'ready') {
        const canvas = copyCanvas(result.canvas);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${geometry.type} thumbnail`);
        thumbnail.appendChild(canvas);
      } else {
        const fallback = element('div', 'p3d-debug__geometry-placeholder', compact ? '—' : 'No preview');
        fallback.title = humanize(result.reason);
        thumbnail.appendChild(fallback);
      }
    } else {
      thumbnail.appendChild(element('div', 'p3d-debug__geometry-placeholder', compact ? '—' : 'Unavailable'));
    }
    return thumbnail;
  }

  private _resourceName(graph: GraphDebugGraphSnapshot, resourceId: number): string {
    const resource = graph.resources[resourceId];
    if (!resource) return `resource ${resourceId}`;
    if (resource.isDefaultColor) return 'defaultColor';
    if (resource.isDefaultDepth) return 'defaultDepth';
    return `${resource.kind === 'transient' ? 'T' : 'I'}${resource.id}:${resource.type}`;
  }

  private _renderAccessLine(
    graph: GraphDebugGraphSnapshot,
    access: GraphDebugPassSnapshot['accesses'][number],
  ): HTMLElement {
    const resourceName = this._resourceName(graph, access.handleId);

    let glyph = '◇';
    let body = `${resourceName} [read]`;
    let color = '#9adfd5';
    if (access.mode === 'write_attachment') {
      glyph = '→';
      body = `${resourceName} [${access.effectiveLoadOp ?? '?'}]`;
      color = access.effectiveLoadOp === 'clear' ? '#ff9eb4' : '#9ed1ff';
    } else if (access.mode === 'read_attachment') {
      glyph = '↺';
      body = `${resourceName} (depthRead)`;
      color = '#c9b0ff';
    } else if (access.mode === 'produce') {
      glyph = '⊕';
      body = `${resourceName} [produce]`;
      color = '#ffcc66';
    } else if (access.mode === 'sample') {
      glyph = '⊙';
      body = `${resourceName} @ slot ${access.slot}`;
      color = '#b0e6b0';
    }
    const line = element('div', 'p3d-debug__access', `${glyph} ${body}`);
    line.style.color = color;
    return line;
  }

  private _metric(label: string, value: string | number): HTMLElement {
    const metric = element('div', 'p3d-debug__metric');
    metric.appendChild(
      element('span', 'p3d-debug__metric-value', typeof value === 'number' ? formatNumber(value) : value),
    );
    metric.appendChild(element('span', 'p3d-debug__metric-label', label));
    return metric;
  }

  private _status(status: PassStatus): HTMLElement {
    return element('span', `p3d-debug__status p3d-debug__status--${status}`, humanize(status));
  }

  private _drawBuildStatus(status: PassStatus): HTMLElement {
    return element('span', `p3d-debug__status p3d-debug__status--${status}`, DRAW_BUILD_STATUS_LABELS[status]);
  }

  private _bundleStatus(status: GraphDebugBundleSnapshot['status']): HTMLElement {
    return element('span', `p3d-debug__status p3d-debug__status--bundle-${status}`, BUNDLE_STATUS_LABELS[status]);
  }

  private _button(label: string, action: () => void): HTMLButtonElement {
    const button = element('button', 'p3d-debug__button', label);
    button.type = 'button';
    button.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) return;
      action();
      this._renderCurrent();
    };
    return button;
  }

  private _startRecording(): void {
    const view = this._getView();
    if (!view?._graph) return;

    this._debugger.reset();
    const geometries: Geometry3D[] = [];
    const snapshot = this._debugger.capture((geometry) => geometries.push(geometry));
    if (!snapshot) return;

    this._recording.start();
    this._snapshot = snapshot;
    this._selectedFrame = null;
    this._copyStatus = '';
    this._geometryThumbnails.clear();
    for (let i = 0; i < geometries.length; i++) this._captureGeometry(geometries[i]);
    this._recordSnapshot(snapshot);
  }

  private _captureRecordingFrame(): GraphDebugSnapshot | null {
    const snapshot = this._debugger.capture(this._captureGeometry);
    if (!snapshot) return null;

    this._snapshot = snapshot;
    this._recordSnapshot(snapshot);
    return snapshot;
  }

  private _stopRecording(): void {
    this._recording.stop();
    this._finishRecording();
  }

  private _recordSnapshot(snapshot: GraphDebugSnapshot): void {
    const result = this._recording.record(snapshot);
    if (result !== 'frame-limit') return;

    this._finishRecording(`Stopped at ${formatNumber(this._recording.maxFrames)} frame limit`);
  }

  private _finishRecording(status = ''): void {
    this._copyStatus = '';
    if (this._reviewView === 'workload') this._selectLatestWorkChangeFrame();
    else this._selectRecordedFrame(this._recording.frames.length - 1);
    this._copyStatus = status;
  }

  private _selectLatestWorkChangeFrame(): void {
    const frames = this._recording.frames;
    if (frames.length === 0) return;

    const changedIndex = this._findWorkChangeFrame(frames.length, -1);
    const index = changedIndex < 0 ? frames.length - 1 : changedIndex;
    this._selectRecordedFrame(index);
  }

  private _selectRecordedFrame(index: number): void {
    const frame = this._recording.frames[index];
    if (!frame) return;
    this._selectedFrame = index;
    this._snapshot = frame.snapshot;
    this._copyStatus = '';
    if (this._reviewView === 'workload') this._normalizeSelection();
  }

  private _findWorkChangeFrame(from: number, direction: -1 | 1): number {
    const frames = this._recording.frames;
    for (let i = from + direction; i >= 0 && i < frames.length; i += direction) {
      const frame = frames[i];
      if (
        frame.drawRebuiltBatchPassCount > 0 ||
        frame.bundleRecordedBatchPassCount > 0 ||
        frame.bundleInvalidatedBatchPassCount > 0
      ) {
        return i;
      }
    }
    return -1;
  }

  private _workloadFrameDetail(frame: GraphDebugRecordedFrame): string {
    const parts = [
      formatCount(frame.drawRebuiltBatchPassCount, 'draw rebuild'),
      formatCount(frame.bundleRecordedBatchPassCount, 'bundle recording'),
    ];
    if (frame.bundleInvalidatedBatchPassCount > 0) {
      parts.push(formatCount(frame.bundleInvalidatedBatchPassCount, 'pending bundle'));
    }
    parts.push(formatCount(frame.dynamicDrawBatchPassCount, 'dynamic pass', 'dynamic passes'));
    parts.push(formatCount(frame.snapshot.summary.drawCallCount, 'draw'));
    return parts.join(' · ');
  }

  private _copyJSON(value: unknown, successMessage: string): void {
    const json = JSON.stringify(value, null, 2);
    if (!navigator.clipboard) {
      this._copyStatus = copyText(json) ? successMessage : 'Copy failed';
      return;
    }
    void navigator.clipboard.writeText(json).then(
      () => {
        this._copyStatus = successMessage;
        this._renderCurrent();
      },
      () => {
        this._copyStatus = copyText(json) ? successMessage : 'Copy failed';
        this._renderCurrent();
      },
    );
  }

  private _normalizeSelection(): void {
    const snapshot = this._snapshot;
    if (!snapshot) return;
    const passes = this._workloadPasses(snapshot);
    if (!this._selectedPass || !passes.some((pass) => pass.name === this._selectedPass)) {
      this._selectedPass = passes.find((pass) => pass.active)?.name ?? passes[0]?.name ?? null;
    }
    if (!this._selectedPass) return;
    const entries = this._batchPasses(snapshot, this._selectedPass);
    if (!entries.some((entry) => entry.batch.id === this._selectedBatch)) {
      this._selectedBatch = entries[0]?.batch.id ?? null;
    }
    const selected = entries.find((entry) => entry.batch.id === this._selectedBatch);
    if (!selected?.pass.draws.some((draw) => draw.index === this._selectedDraw)) {
      this._selectedDraw = null;
    }
  }

  private _batchPasses(snapshot: GraphDebugSnapshot, passName: string): BatchPassEntry[] {
    const entries: BatchPassEntry[] = [];
    for (let i = 0; i < snapshot.batches.length; i++) {
      const pass = snapshot.batches[i].passes.find((item) => item.name === passName);
      if (pass) entries.push({ batch: snapshot.batches[i], pass });
    }
    return entries;
  }

  private _workloadPasses(snapshot: GraphDebugSnapshot): GraphDebugPassSnapshot[] {
    return snapshot.graph.passes.filter((pass) => pass.sceneWorkload !== null);
  }

  private _workloadStatus(pass: GraphDebugPassSnapshot, metrics: PassMetrics): PassStatus {
    if (!pass.active) return 'skipped';
    if (metrics.drawBuild === 'empty') return 'no-draws';
    return metrics.drawBuild;
  }

  private _passMetrics(snapshot: GraphDebugSnapshot, passName: string): PassMetrics {
    const entries = this._batchPasses(snapshot, passName);
    let draws = 0;
    let triangles = 0;
    const drawStatuses = new Set<GraphDebugDrawBuildSnapshot['status']>();
    const bundleStatuses = new Set<GraphDebugBundleSnapshot['status']>();
    for (let i = 0; i < entries.length; i++) {
      const pass = entries[i].pass;
      draws += pass.drawCallCount;
      triangles += this._passTriangles(pass);
      drawStatuses.add(pass.drawBuild.status);
      bundleStatuses.add(pass.bundle.status);
    }
    let drawBuild: PassMetrics['drawBuild'] = 'empty';
    if (drawStatuses.has('rebuilt')) drawBuild = 'rebuilt';
    else if (drawStatuses.has('dynamic')) drawBuild = 'dynamic';
    else if (drawStatuses.has('first-capture')) drawBuild = 'first-capture';
    else if (drawStatuses.has('reused')) drawBuild = 'reused';

    let bundle: PassMetrics['bundle'] = 'empty';
    if (bundleStatuses.has('invalidated')) bundle = 'invalidated';
    else if (bundleStatuses.has('recorded')) bundle = 'recorded';
    else if (bundleStatuses.has('first-capture')) bundle = 'first-capture';
    else if (bundleStatuses.has('reused')) bundle = 'reused';
    else if (bundleStatuses.has('not-used')) bundle = 'not-used';
    return { batches: entries.length, draws, triangles, drawBuild, bundle };
  }

  private _snapshotTriangles(snapshot: GraphDebugSnapshot): number {
    let total = 0;
    for (const batch of snapshot.batches) {
      for (const pass of batch.passes) total += this._passTriangles(pass);
    }
    return total;
  }

  private _passTriangles(pass: GraphDebugBatchPassSnapshot): number {
    let total = 0;
    for (const draw of pass.draws) total += draw.drawnTriangleCount ?? draw.sourceTriangleCount ?? 0;
    return total;
  }

  private _passResourceCounts(pass: GraphDebugBatchPassSnapshot): {
    /** Distinct geometry ids referenced by the pass's draws */
    geometries: number;
    /** Distinct material ids referenced by the pass's draws */
    materials: number;
    /** Distinct texture ids referenced by the pass's draws */
    textures: number;
  } {
    const geometries = new Set<number>();
    const materials = new Set<number>();
    const textures = new Set<number>();
    for (const draw of pass.draws) {
      for (const id of draw.geometryIds) geometries.add(id);
      for (const id of draw.materialIds) materials.add(id);
      for (const id of draw.textureIds) textures.add(id);
    }
    return { geometries: geometries.size, materials: materials.size, textures: textures.size };
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

function humanize(value: string): string {
  return value.replaceAll('-', ' ');
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function limitedIds(ids: number[]): string {
  const shown = ids.slice(0, 20).join(', ');
  return ids.length > 20 ? `${shown}, … +${ids.length - 20}` : shown;
}

function copyText(value: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0);
  return canvas;
}
