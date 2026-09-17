import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

import { downloadAssets } from '../scripts/assets/download-assets.mts';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.dds': 'application/octet-stream',
  '.basis': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.cubemap': 'application/json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.fnt': 'text/plain',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

function serveStaticAssets(): Plugin {
  const routes: [string, string][] = [
    ['/test-assets/', path.resolve(projectRoot, 'examples/assets')],
    ['/snapshots/', path.resolve(projectRoot, 'tests/snapshots')],
    // Local mirror of the remote assets in examples/assets/manifest.ts, served at the
    // same /mirror/ route the vitest harness uses so manifest URLs resolve
    // identically here.
    ['/mirror/', path.resolve(projectRoot, 'examples/assets/mirror')],
    // glTF visual-test scenes share frameModel.ts, which loads the Venice Sunset
    // IBL from the root-absolute `/venice-sunset/` path the vitest harness serves
    // (its publicDir is examples/assets). Mirror that here so the same scenes run
    // unchanged in the playground.
    ['/venice-sunset/', path.resolve(projectRoot, 'examples/assets/venice-sunset')],
  ];

  return {
    name: 'serve-static-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';

        for (const [prefix, baseDir] of routes) {
          if (!url.startsWith(prefix)) continue;

          const relative = decodeURIComponent(url.slice(prefix.length).split('?')[0]);
          const filePath = path.resolve(baseDir, relative);

          if (!filePath.startsWith(baseDir)) {
            res.statusCode = 403;
            res.end('Forbidden');

            return;
          }

          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end('Not Found');

            return;
          }

          const ext = path.extname(filePath).toLowerCase();

          res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(filePath).pipe(res);

          return;
        }

        next();
      });
    },
  };
}

// WebGPU only exists in secure contexts, so on-device testing over the LAN
// (a bare-IP origin) needs HTTPS — point these at a (self-signed) key/cert
// pair to enable it. Unset = plain HTTP, unchanged.
const httpsKey = process.env.PLAYGROUND_HTTPS_KEY;
const httpsCert = process.env.PLAYGROUND_HTTPS_CERT;

// A tunnel (`cloudflared tunnel --url http://localhost:5173`) is the other way to
// get an HTTPS origin for on-device WebGPU testing. Vite rejects Host headers it
// doesn't know, so allow the tunnel domains; a leading dot covers subdomains.
// Extra hosts can be added with PLAYGROUND_ALLOWED_HOSTS=host-a,host-b.
const allowedHosts = [
  '.trycloudflare.com',
  ...(process.env.PLAYGROUND_ALLOWED_HOSTS?.split(',')
    .map((host) => host.trim())
    .filter(Boolean) ?? []),
];

export default defineConfig({
  plugins: [
    // Fill any gaps in the local asset mirror (examples/assets/manifest.ts) before the
    // server is up, so a fresh clone can run the playground without a manual
    // `npm run download:assets`.
    { name: 'download-assets', buildStart: () => downloadAssets() },
    preact(),
    serveStaticAssets(),
  ],
  resolve: {
    alias: {
      'pixi.js': path.resolve(projectRoot, 'node_modules/pixi.js'),
      '~': path.resolve(projectRoot, 'src'),
      // Subpaths must precede the bare package alias: vite matches aliases in order.
      '@pixi/3d/webgl': path.resolve(projectRoot, 'src/core/gl/init.ts'),
      '@pixi/3d/webgpu': path.resolve(projectRoot, 'src/core/gpu/init.ts'),
      '@pixi/3d/extras': path.resolve(projectRoot, 'src/extras/index.ts'),
      '@pixi/3d': path.resolve(projectRoot, 'src/index.ts'),
    },
  },
  server: {
    https: httpsKey && httpsCert ? { key: fs.readFileSync(httpsKey), cert: fs.readFileSync(httpsCert) } : undefined,
    allowedHosts,
    fs: {
      // pixi.js by its real path too, so a linked checkout of it is served.
      allow: [projectRoot, fs.realpathSync(path.resolve(projectRoot, 'node_modules/pixi.js'))],
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        'scene-frame': path.resolve(root, 'scene-frame.html'),
      },
    },
  },
});
