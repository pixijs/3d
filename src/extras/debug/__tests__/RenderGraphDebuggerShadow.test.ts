import { getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { cpuSubmission } from '~/core/cull';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import type { GraphDebugBundleSnapshot } from '../GraphDebugSnapshot';
import { RenderGraphDebugger } from '../GraphDebugSnapshot';

const SIZE = 128;

const THROTTLED_RATE = 8;

type BundleReading = Pick<GraphDebugBundleSnapshot, 'status' | 'causes'>;

const NOT_USED: GraphDebugBundleSnapshot = {
  status: 'not-used',
  bundleDirtyId: null,
  lastBundleDirtyId: null,
  causes: [],
};

function buildScene(app: Application<Renderer>): { view3d: View3D; sun: DirectionalLight } {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888 }),
    castShadow: false,
  });
  ground.position.set(0, -0.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  view3d.root.addChild(createCaster());

  const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 2, maxDistance: 30 } });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(4, 6, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return { view3d, sun };
}

function createCaster(): Mesh3D {
  return new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: 0x4a7c59 }),
    castShadow: true,
  });
}

function addSpot(view3d: View3D): SpotLight {
  const spot = new SpotLight({ range: 20, coneAngle: 40, castShadow: true, shadow: { update: THROTTLED_RATE } });
  spot.position.set(0, 6, 0);
  view3d.root.addChild(spot);
  spot.lookAt({ x: 0, y: 0, z: 0 });
  return spot;
}

function renderShadowBundle(app: Application<Renderer>, debug: RenderGraphDebugger): GraphDebugBundleSnapshot {
  app.render();
  const passes = debug.capture()!.batches.flatMap((batch) => batch.passes);
  const shadow = passes.find((pass) => pass.name === 'shadow');

  expect(shadow, 'the shadow pass drew the cube').toBeDefined();

  return shadow!.bundle;
}

function readingOf(bundle: GraphDebugBundleSnapshot): BundleReading {
  return { status: bundle.status, causes: bundle.causes };
}

async function withScene(
  id: string,
  run: (app: Application<Renderer>, scene: ReturnType<typeof buildScene>) => void,
  preference: 'webgl' | 'webgpu' = 'webgpu',
): Promise<void> {
  const app = await getApp<Renderer>({
    id: `${id}-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE },
  });
  try {
    run(app, buildScene(app));
  } finally {
    app.destroy();
  }
}

describe('RenderGraphDebugger on the shadow pass', () => {
  afterEach(() => {
    delete cpuSubmission.shadow;
  });

  it('reads a steady frame as replaying the bundles the lights recorded', async () => {
    await withScene('debug-shadow-steady', (app, { view3d }) => {
      const debug = new RenderGraphDebugger({ view: view3d });

      renderShadowBundle(app, debug);
      const steady = [renderShadowBundle(app, debug).status, renderShadowBundle(app, debug).status];

      expect(steady).toEqual(['reused', 'reused']);
    });
  });

  it('reads a manual light as reusing its bundles, even on the frame refreshShadows redraws it', async () => {
    await withScene('debug-shadow-manual', (app, { view3d, sun }) => {
      sun.shadow.update = 'manual';
      const debug = new RenderGraphDebugger({ view: view3d });

      renderShadowBundle(app, debug);
      const skipped = [renderShadowBundle(app, debug).status, renderShadowBundle(app, debug).status];
      sun.refreshShadows();
      skipped.push(renderShadowBundle(app, debug).status);

      expect(skipped).toEqual(['reused', 'reused', 'reused']);
    });
  });

  it('reads a shadow quality change as one bundle recording', async () => {
    await withScene('debug-shadow-rerecord', (app, { view3d }) => {
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);

      view3d.shadowQuality = 'high';
      const frames = [renderShadowBundle(app, debug), renderShadowBundle(app, debug)];

      expect(frames.map(readingOf)).toEqual([
        { status: 'recorded', causes: [{ code: 'bundle-only-change' }] },
        { status: 'reused', causes: [] },
      ]);
    });
  });

  it('reads a bundle as pending while a cascade its update rate skips still has to re-record', async () => {
    await withScene('debug-shadow-throttled', (app, { view3d, sun }) => {
      sun.shadow.update = [1, THROTTLED_RATE];
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);

      view3d._invalidateBundleCaches();
      const skipped = renderShadowBundle(app, debug).status;
      sun.refreshShadows();
      const refreshed = renderShadowBundle(app, debug).status;

      expect([skipped, refreshed]).toEqual(['invalidated', 'recorded']);
    });
  });

  it('reads a draw rebuild as pending, with its cause, until a skipped cascade re-records', async () => {
    await withScene('debug-shadow-throttled-rebuild', (app, { view3d, sun }) => {
      sun.shadow.update = [1, THROTTLED_RATE];
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);

      const second = createCaster();
      second.position.set(2, 0, 0);
      view3d.root.addChild(second);
      view3d._sceneBatch.invalidateDrawCaches();
      const frames = [renderShadowBundle(app, debug), renderShadowBundle(app, debug)];
      sun.refreshShadows();
      frames.push(renderShadowBundle(app, debug), renderShadowBundle(app, debug));

      expect(frames.map(readingOf)).toEqual([
        { status: 'invalidated', causes: [{ code: 'draws-rebuilt' }] },
        { status: 'invalidated', causes: [{ code: 'draws-rebuilt' }] },
        { status: 'recorded', causes: [{ code: 'draws-rebuilt' }] },
        { status: 'reused', causes: [] },
      ]);
    });
  });

  it('reads a cascade that waits for refreshShadows as keeping its old bundle, not pending', async () => {
    await withScene('debug-shadow-waiting', (app, { view3d, sun }) => {
      sun.shadow.update = [1, 0];
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);

      const second = createCaster();
      second.position.set(2, 0, 0);
      view3d.root.addChild(second);
      view3d._sceneBatch.invalidateDrawCaches();
      const frames = [renderShadowBundle(app, debug), renderShadowBundle(app, debug)];
      sun.refreshShadows();
      frames.push(renderShadowBundle(app, debug), renderShadowBundle(app, debug));

      expect(frames.map(readingOf)).toEqual([
        { status: 'recorded', causes: [{ code: 'draws-rebuilt' }] },
        { status: 'reused', causes: [] },
        { status: 'recorded', causes: [{ code: 'draws-rebuilt' }] },
        { status: 'reused', causes: [] },
      ]);
    });
  });

  it('reads the oldest bundle across every casting light', async () => {
    await withScene('debug-shadow-two-lights', (app, { view3d }) => {
      const spot = addSpot(view3d);
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);

      view3d._invalidateBundleCaches();
      const spotStale = renderShadowBundle(app, debug).status;
      spot.refreshShadows();
      const refreshed = renderShadowBundle(app, debug).status;

      expect([spotStale, refreshed]).toEqual(['invalidated', 'recorded']);
    });
  });

  it('reads only the lights still casting when one of two is hidden', async () => {
    await withScene('debug-shadow-one-hidden', (app, { view3d }) => {
      const spot = addSpot(view3d);
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);

      view3d._invalidateBundleCaches();
      spot.visible = false;

      expect(renderShadowBundle(app, debug).status).toBe('recorded');
    });
  });

  it('reads a frame where the only shadow light is hidden as using no bundle', async () => {
    await withScene('debug-shadow-hidden', (app, { view3d, sun }) => {
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);

      sun.visible = false;
      const hidden = renderShadowBundle(app, debug);
      sun.visible = true;
      const shown = [renderShadowBundle(app, debug).status, renderShadowBundle(app, debug).status];

      expect(hidden).toEqual(NOT_USED);
      expect(shown).toEqual(['first-capture', 'reused']);
    });
  });

  it('reads a frustum-culled batch its cascades draw direct as using no bundle', async () => {
    await withScene('debug-shadow-direct', (app, { view3d }) => {
      cpuSubmission.shadow = Infinity;
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);

      expect([renderShadowBundle(app, debug), renderShadowBundle(app, debug)]).toEqual([NOT_USED, NOT_USED]);
    });
  });

  it("reads an 'off' batch its cascades draw direct as replaying the bundles of its direct draws until a count changes", async () => {
    await withScene('debug-shadow-direct-off', (app, { view3d }) => {
      cpuSubmission.shadow = Infinity;
      view3d.cull = 'off';
      const second = createCaster();
      second.position.set(2, 0, 0);
      view3d.root.addChild(second);
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      const steady = [renderShadowBundle(app, debug).status, renderShadowBundle(app, debug).status];

      second.visible = false;
      const hidden = [renderShadowBundle(app, debug), renderShadowBundle(app, debug)];

      expect(steady).toEqual(['reused', 'reused']);
      expect(hidden.map(readingOf)).toEqual([
        { status: 'recorded', causes: [{ code: 'counts-changed' }] },
        { status: 'reused', causes: [] },
      ]);
    });
  });

  it("reads a second light hidden and shown again as reusing an 'off' batch's bundles of direct draws", async () => {
    await withScene('debug-shadow-direct-off-light-toggle', (app, { view3d }) => {
      cpuSubmission.shadow = Infinity;
      view3d.cull = 'off';
      const second = createCaster();
      second.position.set(2, 0, 0);
      view3d.root.addChild(second);
      const spot = addSpot(view3d);
      spot.shadow.update = 1;
      const debug = new RenderGraphDebugger({ view: view3d });
      renderShadowBundle(app, debug);
      renderShadowBundle(app, debug);
      second.visible = false;
      const countChanged = readingOf(renderShadowBundle(app, debug));
      renderShadowBundle(app, debug);

      spot.visible = false;
      const spotHidden = readingOf(renderShadowBundle(app, debug));
      spot.visible = true;
      const spotShown = readingOf(renderShadowBundle(app, debug));

      expect(countChanged).toEqual({ status: 'recorded', causes: [{ code: 'counts-changed' }] });
      expect([spotHidden, spotShown]).toEqual([
        { status: 'reused', causes: [] },
        { status: 'reused', causes: [] },
      ]);
    });
  });

  it('reads every WebGL frame as using no bundle, since WebGL records none', async () => {
    await withScene(
      'debug-shadow-webgl',
      (app, { view3d }) => {
        const debug = new RenderGraphDebugger({ view: view3d });
        renderShadowBundle(app, debug);

        expect(renderShadowBundle(app, debug)).toEqual(NOT_USED);
      },
      'webgl',
    );
  });
});

describe('RenderGraphDebugger on direct draws', () => {
  afterEach(() => {
    delete cpuSubmission.forward;
    delete cpuSubmission.shadow;
  });

  it('reads a batch the passes draw direct as using no bundle, frame after frame', async () => {
    cpuSubmission.forward = Infinity;
    cpuSubmission.shadow = Infinity;
    await withScene('debug-direct-draws', (app, { view3d }) => {
      const debug = new RenderGraphDebugger({ view: view3d });
      const bundles = (name: string) => {
        app.render();
        const pass = debug
          .capture()!
          .batches.flatMap((batch) => batch.passes)
          .find((p) => p.name === name);

        expect(pass, `the ${name} pass drew the batch`).toBeDefined();

        return pass!.bundle;
      };

      bundles('opaque');

      expect([bundles('opaque'), bundles('opaque')], 'the opaque pass').toEqual([NOT_USED, NOT_USED]);
      expect([bundles('shadow'), bundles('shadow')], 'each sun cascade').toEqual([NOT_USED, NOT_USED]);
    });
  });
});
