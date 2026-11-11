/**
 * The pane's rows: how many cards there are, which card's shape spins, which card is in focus, that card's
 * `camera.fov`, and a reset
 *
 * The rows only call back into `index.ts`, so every view and camera call stays there.
 */

import type { ArrayStyleListOptions, ListBladeApi } from 'tweakpane';

import type { ThemePane } from '../shared/theme/ThemePane';
import type { Card } from './scene';

/** `Spinning`'s value when no card's shape turns */
export const NO_CARD = -1;
/**
 * The `camera.fov` row's range: from a close zoom, where the tallest shape fills about half its view's height, to 50,
 * the widest at which the frustum stays inside the overview
 */
const FOV_RANGE = { min: 26, max: 50 };

/** What the rows show; `index.ts` writes it back when the scene changes under a row */
export interface ControlState {
  cards: number;
  /** {@link NO_CARD}, or the index of the card whose shape spins */
  spinning: number;
  /** The index of the card the overview shows and `camera.fov` zooms */
  focus: number;
  /** The focus card's `camera.fov` */
  fov: number;
}

export interface ControlsOptions {
  pane: ThemePane;
  state: ControlState;
  /** Every card, read live, so the lists show the ones there are */
  cards: readonly Card[];
  maxCards: number;
  onCards: (count: number) => void;
  onFocus: (index: number) => void;
  onFov: (fov: number) => void;
  onReset: () => void;
}

export interface Controls {
  /** Shows the state again, after the scene changed it */
  refresh(): void;
}

export function createControls(options: ControlsOptions): Controls {
  const { pane, state, cards, maxCards, onCards, onFocus, onFov, onReset } = options;
  const count = pane.addBinding(state, 'cards', { label: 'Cards', min: 1, max: maxCards, step: 1 });
  // List blades, since a binding's options can't change once it's built and these follow the card count.
  const spinning = pane.addBlade({
    view: 'list',
    label: 'Spinning',
    options: [{ text: 'None', value: NO_CARD }, ...cardOptions(cards)],
    value: state.spinning,
  }) as ListBladeApi<number>;
  const focus = pane.addBlade({
    view: 'list',
    label: 'Focus',
    options: cardOptions(cards),
    value: state.focus,
  }) as ListBladeApi<number>;
  const fov = pane.addBinding(state, 'fov', { label: 'camera.fov', step: 1, ...FOV_RANGE });
  // Setting a row from code fires its `change`, and a row the scene moved isn't a new choice.
  let refreshing = false;

  function refresh(): void {
    refreshing = true;
    spinning.options = [{ text: 'None', value: NO_CARD }, ...cardOptions(cards)];
    spinning.value = state.spinning;
    focus.options = cardOptions(cards);
    focus.value = state.focus;
    fov.refresh();
    refreshing = false;
  }

  count.on('change', ({ value }) => {
    onCards(value);
    refresh();
  });
  spinning.on('change', ({ value }) => {
    if (!refreshing) state.spinning = value;
  });
  focus.on('change', ({ value }) => {
    if (refreshing) return;
    onFocus(value);
    refresh();
  });
  fov.on('change', ({ value }) => {
    if (!refreshing) onFov(value);
  });
  pane.addButton({ title: 'Reset cameras' }).on('click', () => {
    onReset();
    refresh();
  });

  return { refresh };
}

/** Each card by its place in the grid and its name */
function cardOptions(cards: readonly Card[]): ArrayStyleListOptions<number> {
  return cards.map((card, i) => ({ text: `${i + 1} · ${card.name}`, value: i }));
}
