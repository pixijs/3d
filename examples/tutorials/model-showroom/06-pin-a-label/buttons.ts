import { Container, Graphics, Text } from 'pixi.js';
import type { Application } from 'pixi.js';

import type { Clips } from './clips';

const WIDTH = 104;
const HEIGHT = 44;
const GAP = 12;

export function addButtons(app: Application, clips: Clips) {
  const bar = new Container();

  app.stage.addChild(bar);

  // One button for each animation: a rounded rectangle with the name on it
  const buttons = clips.labels.map((label, i) => {
    const background = new Graphics();
    const text = new Text({
      text: label,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: '600', fill: 0xffffff },
    });
    const button = new Container();

    text.anchor.set(0.5);
    text.position.set(WIDTH / 2, 0);
    button.addChild(background, text);
    button.x = i * (WIDTH + GAP);

    // Take pointer events, show a hand cursor, and switch animations on a click or a tap
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointertap', () => {
      clips.play(label);
      draw();
    });

    bar.addChild(button);

    return { label, background };
  });

  // Fill the button of the active animation, and outline the others
  const draw = () => {
    for (const { label, background } of buttons) {
      const active = label === clips.current;

      background
        .clear()
        .roundRect(0, -HEIGHT / 2, WIDTH, HEIGHT, HEIGHT / 2)
        .fill({ color: active ? 0xd81b60 : 0x1d1a24, alpha: active ? 1 : 0.6 })
        .stroke({ color: 0xffffff, alpha: active ? 0 : 0.6, width: 1.5 });
    }
  };

  // Centre the row near the bottom of the screen, and shrink it on a narrow one
  const layout = () => {
    const width = buttons.length * (WIDTH + GAP) - GAP;
    const scale = Math.min(1, (app.screen.width - 32) / width);

    bar.scale.set(scale);
    bar.position.set((app.screen.width - width * scale) / 2, app.screen.height - 48);
  };

  draw();
  layout();
  app.renderer.on('resize', layout);
}
