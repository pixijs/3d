import { RendererType } from 'pixi.js';
import type { TEXTURE_FORMATS, WebGLRenderer, WebGPURenderer } from 'pixi.js';

/**
 * The WebGPU spec's render target pixel byte cost and component alignment, which isn't the texel
 * size: `rgba8unorm` costs 8
 */
const BYTE_COST: Partial<Record<TEXTURE_FORMATS, readonly [cost: number, alignment: number]>> = {
  r8unorm: [1, 1],
  r8uint: [1, 1],
  r8sint: [1, 1],
  rg8unorm: [2, 1],
  rg8uint: [2, 1],
  rg8sint: [2, 1],
  rgba8unorm: [8, 1],
  'rgba8unorm-srgb': [8, 1],
  rgba8uint: [4, 1],
  rgba8sint: [4, 1],
  bgra8unorm: [8, 1],
  'bgra8unorm-srgb': [8, 1],
  r16uint: [2, 2],
  r16sint: [2, 2],
  r16float: [2, 2],
  rg16uint: [4, 2],
  rg16sint: [4, 2],
  rg16float: [4, 2],
  rgba16uint: [8, 2],
  rgba16sint: [8, 2],
  rgba16float: [8, 2],
  r32uint: [4, 4],
  r32sint: [4, 4],
  r32float: [4, 4],
  rg32uint: [8, 4],
  rg32sint: [8, 4],
  rg32float: [8, 4],
  rgba32uint: [16, 4],
  rgba32sint: [16, 4],
  rgba32float: [16, 4],
  rgb10a2unorm: [8, 4],
  rg11b10ufloat: [8, 4],
};

/** @internal */
export interface ColorAttachmentFormat {
  format: TEXTURE_FORMATS;
  label?: string;
}

/** @internal */
export function assertColorAttachmentLimits(
  passName: string,
  colors: readonly ColorAttachmentFormat[],
  renderer: WebGLRenderer | WebGPURenderer,
): void {
  let maxCount: number;
  let maxBytes = Infinity;

  if (renderer.type === RendererType.WEBGPU) {
    const limits = (renderer as WebGPURenderer).gpu.device.limits;
    maxCount = limits.maxColorAttachments;
    maxBytes = limits.maxColorAttachmentBytesPerSample;
  } else {
    const gl = (renderer as WebGLRenderer).gl;
    maxCount = Math.min(gl.getParameter(gl.MAX_DRAW_BUFFERS), gl.getParameter(gl.MAX_COLOR_ATTACHMENTS));
  }

  if (colors.length > maxCount) {
    throw new Error(
      `RenderGraph: pass "${passName}" attaches ${colors.length} colour textures, over this GPU's limit of ` +
        `${maxCount}: ${colors.map((c, i) => c.label ?? `attachment ${i}`).join(', ')}. Each scene ` +
        'output adds one to the scene passes, so list fewer.',
    );
  }

  let bytes = 0;
  for (let i = 0; i < colors.length; i++) {
    const cost = BYTE_COST[colors[i].format];
    if (!cost) continue;
    bytes = Math.ceil(bytes / cost[1]) * cost[1] + cost[0];
  }

  if (bytes > maxBytes) {
    const listed = colors.map((c, i) => {
      const { label, format } = c;
      return `${label ?? `attachment ${i}`} (${format}, ${BYTE_COST[format]?.[0] ?? '?'} bytes)`;
    });
    throw new Error(
      `RenderGraph: pass "${passName}" needs ${bytes} bytes per pixel for its colour textures, over WebGPU's ` +
        `limit of ${maxBytes}: ${listed.join(', ')}. Give scene outputs smaller formats or list fewer. ` +
        'rgba8unorm counts 8 bytes, the same as rgba16float; rg16float counts 4, rg8unorm 2 and r8unorm 1.',
    );
  }
}
