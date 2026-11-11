/**
 * The examples' control panel: a Tweakpane pane in the theme's colours, with the light and dark switch on top
 *
 * It is a plain Tweakpane `Pane`, so an example binds its own values under the switch with `addBinding`,
 * `addFolder` and `addButton`.
 */

import { Pane } from 'tweakpane';
import type { BladeApi } from 'tweakpane';

import { NARROW_BELOW } from './overlay';
import { BRAND, cssColor, THEMES } from './palette';
import type { ThemeName } from './palette';
import type { ThemeStage } from './ThemeStage';

/** Shorter screens than this open the pane collapsed too: a phone held sideways */
const SHORT_BELOW = 500;
/** How long a flashed row holds the accent, and how long it then fades back, in seconds */
const FLASH_HOLD = 1.5;
const FLASH_FADE = 0.4;
/** The labels' font, so a read-only monitor's columns line up as the overlays' do */
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
/** Where a row's name is: a binding's label, else a button's title or a folder's */
const ROW_NAME = '.tp-lblv_l, .tp-btnv_t, .tp-fldv_t';

export interface ThemePaneOptions {
  /** The pane's heading: the example's name */
  title: string;
  /** The stage the switch fades between themes */
  stage: ThemeStage;
  /** Seconds a theme switch fades over. @default 0.6 */
  fade?: number;
  /**
   * Whether the pane opens expanded. @default true, or false on a screen under 600 px wide or 500 px tall, so it
   * doesn't cover the scene on a phone either way up
   */
  expanded?: boolean;
  /** CSS px from the top of the page, so an example's own top-right panel keeps the corner. @default 12 */
  top?: number;
}

/** Tweakpane's colour variables for a theme: the rows and inputs are the theme's ink at a low opacity */
function paneColors(theme: ThemeName): Record<string, string> {
  const { ink, inkSoft } = THEMES[theme];
  const text = cssColor(ink);
  const ground = theme === 'light' ? cssColor(BRAND.white) : cssColor(BRAND.night);
  const tint = (alpha: string): string => `${text}${alpha}`;

  return {
    '--tp-base-background-color': `${ground}e6`,
    '--tp-base-shadow-color': theme === 'light' ? '#3c285a26' : '#00000066',
    '--tp-base-font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
    '--tp-button-background-color': tint('1f'),
    '--tp-button-background-color-hover': tint('2e'),
    '--tp-button-background-color-focus': tint('38'),
    '--tp-button-background-color-active': tint('42'),
    '--tp-button-foreground-color': text,
    '--tp-container-background-color': tint('14'),
    '--tp-container-background-color-hover': tint('1f'),
    '--tp-container-background-color-focus': tint('29'),
    '--tp-container-background-color-active': tint('33'),
    '--tp-container-foreground-color': text,
    '--tp-groove-foreground-color': tint('1a'),
    '--tp-input-background-color': tint('0f'),
    '--tp-input-background-color-hover': tint('1a'),
    '--tp-input-background-color-focus': tint('24'),
    '--tp-input-background-color-active': tint('2e'),
    '--tp-input-foreground-color': text,
    '--tp-label-foreground-color': cssColor(inkSoft),
    '--tp-monitor-background-color': tint('0f'),
    '--tp-monitor-foreground-color': cssColor(inkSoft),
  };
}

/**
 * A Tweakpane pane in the top-right corner, painted in the stage's theme, whose first row switches the theme
 *
 * It sits under the loading screen, so it appears as the screen dissolves. Read-only monitors write in the labels'
 * monospace font, so a multi-line log's columns line up. `dispose()` removes it from the page.
 * @example
 * ```ts
 * const pane = new ThemePane({ title: 'Shadows', stage });
 * const bias = pane.addBinding(stage.key.shadow, 'bias', { min: 0, max: 0.01 });
 *
 * pane.addBinding(settings, 'cascades').on('change', () => {
 *   stage.key.shadow.bias = settings.cascades ? 0.002 : 0.005;
 *   bias.refresh();
 *   pane.flash(bias); // shows the reader the row their change moved
 * });
 * ```
 */
export class ThemePane extends Pane {
  private readonly _host: HTMLDivElement;
  /** The fade-back timer of each row a flash holds lit */
  private readonly _flashes = new Map<HTMLElement, number>();

  constructor({
    title,
    stage,
    fade = 0.6,
    expanded = window.innerWidth >= NARROW_BELOW && window.innerHeight >= SHORT_BELOW,
    top = 12,
  }: ThemePaneOptions) {
    const host = document.createElement('div');
    const mono = document.createElement('style');

    host.style.cssText =
      `position:fixed;top:${top}px;right:12px;z-index:5;width:260px;max-width:calc(100vw - 24px);` +
      `max-height:calc(100vh - ${top + 12}px);overflow-y:auto`;
    host.className = 'theme-pane';
    mono.textContent = `.theme-pane .tp-sglv_i,.theme-pane .tp-mllv_i{font-family:${MONO_FONT}}`;
    host.appendChild(mono);
    document.body.appendChild(host);
    super({ container: host, title, expanded });
    this._host = host;
    this._paint(stage.theme);
    this.addBinding({ theme: stage.theme }, 'theme', {
      label: 'Theme',
      options: { Light: 'light', Dark: 'dark' },
    }).on('change', ({ value }) => {
      stage.setTheme(value, fade);
      this._paint(value);
    });
  }

  /**
   * Tints a row's name accent for 1.5 s, then fades it back, so a reader sees which row a change of theirs moved
   *
   * Takes any row the pane made: a binding, a button or a folder. A second flash on a lit row restarts its hold.
   */
  public flash(row: BladeApi): void {
    const name = row.element.querySelector<HTMLElement>(ROW_NAME);

    if (!name) return;
    window.clearTimeout(this._flashes.get(name));
    name.style.transition = 'none';
    name.style.color = cssColor(BRAND.hotPink);
    this._flashes.set(
      name,
      window.setTimeout(() => {
        name.style.transition = `color ${FLASH_FADE}s`;
        name.style.color = '';
        this._flashes.delete(name);
      }, FLASH_HOLD * 1000),
    );
  }

  public override dispose(): void {
    for (const timer of this._flashes.values()) window.clearTimeout(timer);
    this._flashes.clear();
    super.dispose();
    this._host.remove();
  }

  private _paint(theme: ThemeName): void {
    for (const [name, value] of Object.entries(paneColors(theme))) this._host.style.setProperty(name, value);
  }
}
