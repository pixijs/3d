---
title: Set up the app
---

Welcome to Floating Shapes. You'll build a scene of soft clay shapes drifting around a 2D headline, with a camera that leans toward your pointer.

Your code runs inside an async function that runs as soon as it's defined, an [IIFE](https://developer.mozilla.org/en-US/docs/Glossary/IIFE), so it can `await` the setup.

## Create the application

PixiJS 3D draws inside an ordinary PixiJS application. The starting code creates one; initialize it next:

```ts
await app.init({
  preference: 'webgpu',
  resizeTo: window,
  antialias: true,
  background: 0xf3edff,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
```

- `preference: 'webgpu'` asks for WebGPU. In a browser without it, PixiJS uses WebGL2, and PixiJS 3D draws with either.
- `resolution` draws at the screen's pixel density, capped at 2 to limit how many pixels a phone with a very dense screen has to draw.

Then add the canvas to the page:

```ts
document.body.appendChild(app.canvas);
```

The preview fills with pale lavender. In the next step you'll put a 3D view on top of it.
