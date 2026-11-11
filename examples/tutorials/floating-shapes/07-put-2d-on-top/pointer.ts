import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

export function followPointer(app: Application, view3d: View3D) {
  // Where the pointer is, from -1 to 1 across the screen and down it
  const pointer = { x: 0, y: 0 };

  // An interactive stage gets globalpointermove for every pointer move on the page
  app.stage.eventMode = 'static';
  app.stage.on('globalpointermove', (event) => {
    pointer.x = (event.global.x / app.screen.width) * 2 - 1;
    pointer.y = (event.global.y / app.screen.height) * 2 - 1;
  });

  app.ticker.add((ticker) => {
    const { camera } = view3d;

    // Ease the camera a little of the way toward the pointer every frame, then aim it back at the
    // middle. Screen y runs down and 3D y runs up, hence the minus.
    const ease = 0.04 * ticker.deltaTime;

    camera.position.x += (pointer.x * 1.5 - camera.position.x) * ease;
    camera.position.y += (-pointer.y - camera.position.y) * ease;
    camera.lookAt({ x: 0, y: 0, z: 0 });
  });
}
