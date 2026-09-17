import type { ShaderBit } from '@pixi/3d';

/**
 * ShaderBit that produces a "force-field" / holographic intersection effect
 * by sampling the scene depth texture.
 *
 * ### How it works
 *
 * 1. **Depth comparison** — Reads `uOpaqueDepthTexture` (global bind group
 *    slot 7, bound by {@link TransparentRenderPass}) via `textureLoad` and
 *    compares the stored scene depth with the fragment's own depth.
 *    Fragments whose depth is close to existing opaque geometry produce a
 *    bright intersection glow (`smoothstep` with a 0.02 threshold).
 *
 * 2. **Fresnel rim** — Computes a view-dependent fresnel term from the
 *    surface normal and camera direction. Edges facing away from the camera
 *    glow more strongly, giving the classic energy-shield look.
 *
 * 3. **Compositing** — The intersection glow and fresnel rim are combined
 *    (`max`) and applied over a cyan tint colour with partial alpha,
 *    producing a translucent shell that brightens at intersections and
 *    silhouette edges.
 *
 * ### Requirements
 *
 * - Material must use `alphaMode: 'blend'` so it renders in the transparent
 *   pass where `uOpaqueDepthTexture` is populated.
 * - The mesh's inter-stage variables must include `vPosition` (world pos)
 *   and `vNormal` (world normal) — both provided by the standard vertex bit.
 * - `@builtin(position)` is automatically included in `FragmentInput` by
 *   `compileInterStageWgsl`, giving screen-space coordinates for the
 *   `textureLoad` call.
 *
 * ### WebGL fallback
 *
 * The GL path outputs a flat cyan with 50 % alpha (no depth sampling) since
 * WebGL doesn't expose the depth buffer in the same way.
 */
export const depthEffectBit: ShaderBit = {
  name: 'depthEffect',

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  // @builtin(position).z is the fragment depth [0..1].
  let screenPos = input.position;

  // Scaled, sub-rect-clamped UV (off the pow2 padding) for the depth texel lookup.
  let screenUV = screenUVFromWorld(input.vPosition);

  // Sample the opaque scene depth at this fragment's screen position.
  let sceneDepth = textureLoad(uOpaqueDepthTexture, vec2<i32>(screenUV * vec2<f32>(textureDimensions(uOpaqueDepthTexture))), 0);
  let fragDepth = screenPos.z;

  // Intersection glow: brighten fragments whose depth is very close to opaque geometry.
  let depthDiff = sceneDepth - fragDepth;
  let intersectionGlow = 1.0 - smoothstep(0.0, 0.02, depthDiff);

  // Fresnel rim: glow at glancing angles relative to the camera.
  let viewDir = normalize(camera.uCameraPosition - input.vPosition);
  let fresnel = pow(1.0 - max(dot(normalize(input.vNormal), viewDir), 0.0), 2.0);

  let tintColor = vec3<f32>(0.0, 0.85, 1.0);
  let glow = max(intersectionGlow, fresnel * 0.6);

  finalColor = tintColor * (0.15 + glow * 3.0);
  alpha = 0.15 + glow * 0.85;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  finalColor = vec3(0.0, 0.85, 1.0);
  alpha = 0.5;
`,
    },
  },
};
