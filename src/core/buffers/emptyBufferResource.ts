import { BufferUsage, BufferResource } from 'pixi.js';

import { Buffer3D } from './Buffer3D';

/**
 * Shared one-int placeholder bound wherever a bind group needs a storage-buffer
 * slot filled before the real resource is set (per batch or per frame)
 * @internal
 */
export const EMPTY_BUFFER_RESOURCE = new BufferResource({
  buffer: new Buffer3D({
    data: new Int32Array(1),
    usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
    label: 'EmptyBufferResource',
    shrinkToFit: false,
  }),
});
