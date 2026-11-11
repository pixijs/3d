import { createInstanceDataLayout } from '../batcher/instanceDataLayout';
import type { InstanceDataLayout, InstanceDataOptions } from '../batcher/instanceDataLayout';
import { DataStoreBuffer } from './DataStoreBuffer';

const noCopy = (): void => {};

/**
 * A slot's row has its mesh store index, which the shaders already hold, so rows before the batch's
 * first slot go unused
 * @internal
 */
export class InstanceDataStoreBuffer extends DataStoreBuffer {
  public readonly layout: InstanceDataLayout;

  constructor(fields: InstanceDataOptions, firstRow: number, slotCount: number) {
    const layout = createInstanceDataLayout(fields);
    const rowCount = firstRow + slotCount;

    super({ stride: layout.stride, initialSize: rowCount, indexKey: '_instanceStoreIndex', copier: noCopy });

    this.layout = layout;
    this.allocateBlock({ _instanceStoreIndex: -1 }, rowCount);

    const { defaults, stride } = layout;
    const u32 = this.u32Data;
    for (let row = firstRow; row < rowCount; row++) u32.set(defaults, row * stride);
  }
}
