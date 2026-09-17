import type { GltfFormat } from '../GltfFormat';

const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
const GLB_CHUNK_TYPE_BIN = 0x004e4942;
const GLB_MAGIC = 0x46546c67; // 'glTF' in ASCII

/**
 * Parses a binary GLB buffer into JSON and binary buffers
 * @param arrayBuffer - The raw GLB buffer
 * @returns An object containing the parsed glTF JSON and the binary buffers
 * @internal
 */
export function glbToGltf(arrayBuffer: ArrayBuffer): {
  json: GltfFormat;
  buffers: ArrayBuffer[];
} {
  const dataView = new DataView(arrayBuffer);

  // Header
  const magic = dataView.getUint32(0, true);
  const version = dataView.getUint32(4, true);
  const length = dataView.getUint32(8, true);

  if (magic !== GLB_MAGIC) {
    throw new Error(`Invalid GLB magic: ${magic.toString(16)}`);
  }

  if (version < 2) {
    throw new Error(`Unsupported GLB version: ${version}`);
  }

  let json: GltfFormat | undefined;
  const buffers: ArrayBuffer[] = [];

  // Chunks
  let offset = 12;

  while (offset < length) {
    const chunkLength = dataView.getUint32(offset, true);
    const chunkType = dataView.getUint32(offset + 4, true);

    offset += 8;

    if (chunkType === GLB_CHUNK_TYPE_JSON) {
      const jsonText = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset, chunkLength));

      json = JSON.parse(jsonText);
    } else if (chunkType === GLB_CHUNK_TYPE_BIN) {
      // The binary chunk is the first buffer
      const buffer = arrayBuffer.slice(offset, offset + chunkLength);

      buffers.push(buffer);
    }

    offset += chunkLength;
  }

  if (!json) {
    throw new Error('GLB file contains no JSON chunk');
  }

  return { json, buffers };
}
