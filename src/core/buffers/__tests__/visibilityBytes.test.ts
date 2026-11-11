import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import {
  MESH3D_LANE_VISIBILITY,
  MESH3D_STORE_STRIDE,
  Mesh3DDataStoreBuffer,
} from '~/core/buffers/Mesh3DDataStoreBuffer';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const lane = (store: Mesh3DDataStoreBuffer, row: number) =>
  store.u32Data[row * MESH3D_STORE_STRIDE + MESH3D_LANE_VISIBILITY];

const expectRows = (store: Mesh3DDataStoreBuffer, rows: number[], expected: number, label: string) => {
  for (const row of rows) {
    expect(store.visible[row], `${label}: byte of row ${row}`).toBe(expected);
    expect(lane(store, row), `${label}: lane of row ${row}`).toBe(expected);
  }
};

describe('Mesh3DDataStoreBuffer.visible', () => {
  const material = new Material3D();
  const cube = new CubeGeometry();

  it('keeps every byte through growth and drops them on destroy', () => {
    const store = new Mesh3DDataStoreBuffer(4);
    const rows: number[] = [];
    for (let i = 0; i < 300; i++) {
      const row = store.set(new Mesh3D({ geometry: cube, material }));
      if (i % 3 === 0) store.writeVisibility(row, 0);
      rows.push(row);
    }

    expect(store.visible.length).toBe(Math.floor(store.data.length / MESH3D_STORE_STRIDE));
    expectRows(
      store,
      rows.filter((_, i) => i % 3 === 0),
      0,
      'hidden before growth',
    );
    expectRows(
      store,
      rows.filter((_, i) => i % 3 !== 0),
      1,
      'shown before growth',
    );

    store.destroy();
    store.destroy();
    expect(store.visible).toBeNull();
  });

  for (const preference of ['webgl', 'webgpu'] as const) {
    it(`follows a scene mesh's world visibility through the transform pass (${preference})`, async () => {
      const app = await getApp<Renderer>({
        id: `visibility-bytes-${preference}`,
        appOptions: { preference, width: 32, height: 32 },
      });

      try {
        const view3d = new View3D({ width: 32, height: 32 });
        view3d.camera.position.set(0, 0, 20);
        app.stage.addChild(view3d);
        const group = new Container3D();
        view3d.root.addChild(group);
        const grouped = [0, 1, 2].map(() => group.addChild(new Mesh3D({ geometry: cube, material })));
        const loose = view3d.root.addChild(new Mesh3D({ geometry: cube, material }));
        app.render();

        const store = view3d._sceneBatch.storeBuffer;
        const groupedRows = grouped.map((mesh) => mesh._storeIndex);
        expectRows(store, [...groupedRows, loose._storeIndex], 1, 'first frame');

        group.visible = false;
        app.render();
        expectRows(store, groupedRows, 0, 'parent hidden');
        expectRows(store, [loose._storeIndex], 1, 'sibling of the hidden parent');

        loose.visible = false;
        group.visible = true;
        app.render();
        expectRows(store, groupedRows, 1, 'parent shown');
        expectRows(store, [loose._storeIndex], 0, 'mesh hidden');

        view3d.root.removeChild(loose);
        const newcomer = view3d.root.addChild(new Mesh3D({ geometry: cube, material }));
        app.render();
        expectRows(store, [newcomer._storeIndex], 1, 'a newcomer, whatever its row held');
      } finally {
        app.destroy();
      }
    });
  }
});
