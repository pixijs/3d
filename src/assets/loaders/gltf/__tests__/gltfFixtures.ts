import { Loader, loadTextures } from 'pixi.js';
import type { LoaderParser } from 'pixi.js';

const GLB_MAGIC = 0x46546c67;
const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
const GLB_CHUNK_TYPE_BIN = 0x004e4942;

export function pngBytes(): Promise<ArrayBuffer> {
  return encodeImage('image/png');
}

export function webpBytes(): Promise<ArrayBuffer> {
  return encodeImage('image/webp');
}

async function encodeImage(type: string): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(4, 2);
  const context = canvas.getContext('2d')!;

  context.fillStyle = '#f00';
  context.fillRect(0, 0, 4, 2);

  return (await canvas.convertToBlob({ type })).arrayBuffer();
}

export function textureLoader(...parsers: LoaderParser[]): Loader {
  const loader = new Loader();

  loader.parsers.push({ ...loadTextures, config: { ...loadTextures.config, preferWorkers: false } }, ...parsers);

  return loader;
}

export function packGlb(json: unknown, bin: Uint8Array): Blob {
  const jsonChunk = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const length = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;

  const header = new ArrayBuffer(12 + 8);
  const view = new DataView(header);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, jsonChunk.byteLength, true);
  view.setUint32(16, GLB_CHUNK_TYPE_JSON, true);

  const binHeader = new ArrayBuffer(8);
  const binView = new DataView(binHeader);

  binView.setUint32(0, binChunk.byteLength, true);
  binView.setUint32(4, GLB_CHUNK_TYPE_BIN, true);

  return new Blob([header, jsonChunk, binHeader, binChunk]);
}

function pad(bytes: Uint8Array, fill: number): Uint8Array<ArrayBuffer> {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4).fill(fill);

  padded.set(bytes);

  return padded;
}
