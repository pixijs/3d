/**
 * Linear RGB floats, row 0 at the top
 * @internal
 */
export interface RadianceImage {
  width: number;
  height: number;
  data: Float32Array;
}

const latin1 = new TextDecoder('latin1');

/**
 * Adds 0.5 to each mantissa before scaling it by `2^(e - 136)`, as Radiance's own decoder does
 * @throws If the file isn't `32-bit_rle_rgbe` in the standard `-Y <height> +X <width>` layout, or ends early
 * @internal
 */
export function parseRadianceHdr(buffer: ArrayBuffer): RadianceImage {
  const bytes = new Uint8Array(buffer);
  let pos = 0;

  const readLine = (): string => {
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
    const line = latin1.decode(bytes.subarray(start, pos));
    pos++;
    return line;
  };

  for (let line = readLine(); line !== ''; line = readLine()) {
    if (line.startsWith('FORMAT=') && line !== 'FORMAT=32-bit_rle_rgbe') {
      throw new Error(`parseRadianceHdr: unsupported pixel format "${line.slice(7)}"; only 32-bit_rle_rgbe is read.`);
    }
  }

  const size = /^-Y (\d+) \+X (\d+)$/.exec(readLine().trim());
  if (!size) throw new Error('parseRadianceHdr: only the standard "-Y <height> +X <width>" orientation is read.');
  const height = Number(size[1]);
  const width = Number(size[2]);

  const data = new Float32Array(width * height * 3);
  const scanline = new Uint8Array(width * 4);
  const runLength = width >= 8 && width < 0x8000;
  const exponentScale = new Float64Array(256);
  for (let e = 1; e < 256; e++) exponentScale[e] = 2 ** (e - 136);

  for (let y = 0; y < height; y++) {
    if (runLength && bytes[pos] === 2 && bytes[pos + 1] === 2 && ((bytes[pos + 2] << 8) | bytes[pos + 3]) === width) {
      pos += 4;
      for (let channel = 0; channel < 4; channel++) {
        let x = 0;
        while (x < width) {
          if (pos >= bytes.length) throw new Error('parseRadianceHdr: the file ends inside a scanline.');
          let count = bytes[pos++];
          if (count > 128) {
            count -= 128;
            const value = bytes[pos++];
            for (let i = 0; i < count; i++) scanline[x++ * 4 + channel] = value;
          } else {
            for (let i = 0; i < count; i++) scanline[x++ * 4 + channel] = bytes[pos++];
          }
        }
      }
    } else {
      if (pos + width * 4 > bytes.length) throw new Error('parseRadianceHdr: the file ends inside a scanline.');
      scanline.set(bytes.subarray(pos, pos + width * 4));
      pos += width * 4;
    }

    let out = y * width * 3;
    for (let x = 0; x < width; x++) {
      const scale = exponentScale[scanline[x * 4 + 3]];
      data[out] = (scanline[x * 4] + 0.5) * scale;
      data[out + 1] = (scanline[x * 4 + 1] + 0.5) * scale;
      data[out + 2] = (scanline[x * 4 + 2] + 0.5) * scale;
      out += 3;
    }
  }

  return { width, height, data };
}
