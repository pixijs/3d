import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Portal surface — an unlit quad showing a feed texture at each fragment's own screen position
 *
 * The far side has to sit still relative to the *viewer*, not to the quad: walk sideways and the
 * far room should slide past the opening the way it would through a hole in a wall. So the UV is
 * the fragment's screen position rather than the mesh's own, which is the same trick
 * `screenSpaceFuncsBit` uses, minus the pooling.
 *
 * What it declares: one texture slot, `portal`, sampled through the generated `samplePortal`;
 * and one material lane, `baseColor`, a linear RGBA tint whose alpha is the opening's own
 * opacity. Compose it into any material the way {@link PortalMaterial} does.
 *
 * **The feed is assumed to be the view's own size.** There is no `uViewportUVScale` here: a
 * pooled transient holds its content in a `[0, vp]` corner of a power-of-two texture and needs
 * that scale to find it, but a camera's target is bound whole and copied into its render texture
 * texel for texel, so the texture's content *is* its `[0, 1]` UV space. Its aspect ratio must
 * match the view's or the far side is stretched; matching the pixel size too is what keeps it
 * sharp.
 *
 * **Y, one expression on both backends, for opposite reasons.**
 *
 * WGSL: `+Y` in NDC is the top of the surface and a texture's origin is its top-left, so a screen
 * position becomes a UV with Y flipped. The feed reads the same way round — WebGPU orients a
 * render texture exactly as it orients the screen, so the feed is filled the same way up the view
 * is drawn.
 *
 * GLSL: a framebuffer's origin is its bottom-left — what `gl_FragCoord.y` counts up from — so the
 * same screen position becomes a UV with *no* flip, which is why `screenSpaceFuncsBit`, sampling
 * a copy of the bound framebuffer, doesn't flip either. A feed is not that copy: it is a non-root
 * FBO, which WebGL orients the other way from the screen (pixi's `isFrontFaceInverted` is the one
 * spelling of that rule), so the bound projection is flipped while filling it and its rows run
 * against the screen's. Two opposite conventions, one flip between them — arriving back at the
 * expression WGSL needs.
 *
 * One case that leaves out: a View3D drawn *into* a render texture on WebGL (inside a pixi
 * filter, or `renderer.extract`). The outer target is non-root there too, so the two orientations
 * agree rather than oppose and the feed lands upside down. Same root/non-root split the graph
 * executor already carries for its transient binds.
 * @category extras:materials
 * @advanced
 */
export const portalBit: ShaderBit = {
  name: 'portal',

  textures: ['portal'],

  bindings: {
    material: {
      baseColor: 'vec4<f32>',
    },
  },

  gpu: {
    header: /*wgsl*/ `
fn portalScreenUV(worldPos: vec3<f32>) -> vec2<f32> {
  let clip = camera.uViewProjectionMatrix * vec4<f32>(worldPos, 1.0);
  let ndc = clip.xy / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
}
`,
    fragment: {
      material: /*wgsl*/ `
  let portalFeed = samplePortal(portalScreenUV(input.vPosition));

  // A rendered frame: already premultiplied, already exposed and tone-mapped by the pass that
  // drew it. Straight into albedo, tinted by the quad's own colour; the quad's alpha is what
  // decides how solid the opening is, not the feed's.
  albedo *= portalFeed.rgb * material.baseColor.rgb;
  alpha *= material.baseColor.a;
`,
    },
  },

  gl: {
    header: /*glsl*/ `
vec2 portalScreenUV(vec3 worldPos) {
  vec4 clip = uViewProjectionMatrix * vec4(worldPos, 1.0);
  vec2 ndc = clip.xy / clip.w;
  return vec2(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
}
`,
    fragment: {
      material: /*glsl*/ `
  vec4 portalFeed = samplePortal(portalScreenUV(vPosition));

  albedo *= portalFeed.rgb * material.baseColor.rgb;
  alpha *= material.baseColor.a;
`,
    },
  },
};
