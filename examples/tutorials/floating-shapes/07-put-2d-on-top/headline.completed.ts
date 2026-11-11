import { Text } from 'pixi.js';
import type { Application } from 'pixi.js';

export function addHeadline(app: Application) {
  const title = new Text({
    text: 'Floating Shapes',
    style: { fontFamily: 'system-ui, sans-serif', fontWeight: '800', fill: 0x2a1b4d },
  });
  const subtitle = new Text({
    text: 'Made with PixiJS 3D',
    style: { fontFamily: 'system-ui, sans-serif', fontWeight: '500', fill: 0x6b5a99 },
  });

  title.anchor.set(0.5);
  subtitle.anchor.set(0.5);
  app.stage.addChild(title, subtitle);

  // Size and centre the text for the screen, now and whenever the window resizes
  const layout = () => {
    const size = Math.min(84, app.screen.width / 10);
    const x = app.screen.width / 2;
    const y = app.screen.height / 2;

    title.style.fontSize = size;
    title.position.set(x, y - size * 0.25);
    subtitle.style.fontSize = size * 0.32;
    subtitle.position.set(x, y + size * 0.55);
  };

  layout();
  app.renderer.on('resize', layout);
}
