import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { processNodes } from '~/assets/loaders/gltf/process/processNodes';
import type { Scene3DDescriptor } from '~/assets/Scene3DDescriptor';

describe('GLTF KHR_node_visibility', () => {
  it('extracts visible=false from the extension into Scene3DNode.visible', () => {
    const gltf = {
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_node_visibility'],
      nodes: [
        { name: 'visible_default' },
        {
          name: 'hidden',
          extensions: { KHR_node_visibility: { visible: false } },
        },
      ],
    } as unknown as GltfFormat;

    const descriptor: Scene3DDescriptor = {};
    processNodes(gltf, descriptor);

    expect(descriptor.nodes).toHaveLength(2);
    expect(descriptor.nodes![0].visible).toBeUndefined();
    expect(descriptor.nodes![1].visible).toBe(false);
  });

  it('does not set visible when the extension reports visible=true (default)', () => {
    const gltf = {
      asset: { version: '2.0' },
      nodes: [
        {
          name: 'explicitly_visible',
          extensions: { KHR_node_visibility: { visible: true } },
        },
      ],
    } as unknown as GltfFormat;

    const descriptor: Scene3DDescriptor = {};
    processNodes(gltf, descriptor);

    expect(descriptor.nodes![0].visible).toBeUndefined();
  });

  it('ignores nodes without the extension', () => {
    const gltf = {
      asset: { version: '2.0' },
      nodes: [{ name: 'plain' }, { name: 'with_other_ext', extensions: { SOME_OTHER: {} } }],
    } as unknown as GltfFormat;

    const descriptor: Scene3DDescriptor = {};
    processNodes(gltf, descriptor);

    expect(descriptor.nodes![0].visible).toBeUndefined();
    expect(descriptor.nodes![1].visible).toBeUndefined();
  });
});
