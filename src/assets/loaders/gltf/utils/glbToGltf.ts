import type { GltfFormat } from '../GltfFormat';

const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
const GLB_CHUNK_TYPE_BIN = 0x004e4942;
/** `glTF` in ASCII, read as a little-endian uint32 */
const GLB_MAGIC = 0x46546c67;
/** The GLB header: magic, version and total length, a uint32 each */
const GLB_HEADER_BYTES = 12;

/**
 * `buffers` holds the BIN chunk as buffer 0, or is empty when the file has none
 * @internal
 */
export function glbToGltf(arrayBuffer: ArrayBuffer): {
  json: GltfFormat;
  buffers: ArrayBuffer[];
} {
  const dataView = new DataView(arrayBuffer);

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

  let offset = GLB_HEADER_BYTES;

  while (offset < length) {
    const chunkLength = dataView.getUint32(offset, true);
    const chunkType = dataView.getUint32(offset + 4, true);

    offset += 8;

    if (chunkType === GLB_CHUNK_TYPE_JSON) {
      const jsonText = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset, chunkLength));

      json = JSON.parse(jsonText);
    } else if (chunkType === GLB_CHUNK_TYPE_BIN) {
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
