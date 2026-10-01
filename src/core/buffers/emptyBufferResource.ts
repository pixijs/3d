import { BufferUsage, BufferResource } from 'pixi.js';

import { Buffer3D } from './Buffer3D';

/**
 * A shared one-`int` storage buffer that fills a bind group's storage slot until the real one is
 * set, per batch or per frame
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
