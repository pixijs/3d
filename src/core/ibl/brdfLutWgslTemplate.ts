import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';

/**
 * WGSL template for the BRDF-LUT generation pass (see `generateBrdfLut`)
 *
 * Runs the Karis split-sum integration: a full-screen quad where UV x = NdotV
 * and UV y = roughness, Monte Carlo integrating the GGX BRDF per texel.
 * @internal
 */
export const brdfLutWgslTemplate: ShaderBitTemplate = {
  bindGroups: ['local'],
  gpu: /* wgsl */ `
{{header}}

// Geometry function (Smith GGX) for a single direction
fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
   let a = roughness;
   let k = (a * a) / 2.0; // For IBL, use k = a²/2 (different from direct lighting)
   
   return NdotV / (NdotV * (1.0 - k) + k);
}

// Combined geometry function for view and light directions
fn geometrySmith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
   let NdotV = max(dot(N, V), 0.0);
   let NdotL = max(dot(N, L), 0.0);
   let ggx1 = geometrySchlickGGX(NdotV, roughness);
   let ggx2 = geometrySchlickGGX(NdotL, roughness);
   
   return ggx1 * ggx2;
}

// Integrate BRDF for given NdotV and roughness
fn integrateBRDF(NdotV: f32, roughness: f32, sampleCount: u32) -> vec2<f32> {
   let V = vec3<f32>(sqrt(1.0 - NdotV * NdotV), 0.0, NdotV);
   let N = vec3<f32>(0.0, 0.0, 1.0);
   
   var A = 0.0; // Scale
   var B = 0.0; // Bias
   
   for (var i = 0u; i < sampleCount; i++) {
       let Xi = hammersley(i, sampleCount);
       let H = importanceSampleGGX(Xi, N, roughness);
       let L = normalize(2.0 * dot(V, H) * H - V);
       
       let NdotL = max(L.z, 0.0);
       let NdotH = max(H.z, 0.0);
       let VdotH = max(dot(V, H), 0.0);
       
       if NdotL > 0.0 {
           let G = geometrySmith(N, V, L, roughness);
           let G_Vis = (G * VdotH) / (NdotH * NdotV);
           let Fc = pow(1.0 - VdotH, 5.0);
           
           A += (1.0 - Fc) * G_Vis;
           B += Fc * G_Vis;
       }
   }
   
   A = A / f32(sampleCount);
   B = B / f32(sampleCount);
   
   return vec2<f32>(A, B);
}

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
  // Convert from [-1, 1] to [0, 1] for UV.
  // Negate Y because WebGPU maps clip Y=+1 to texture row 0 (top),
  // but UV v=0 also samples row 0 — without the negate, the LUT
  // would be Y-flipped (roughness 0.9 would read as 0.1).
  output.vUv = vec2<f32>(input.aPosition.x * 0.5 + 0.5, -input.aPosition.y * 0.5 + 0.5);
  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
   // X = NdotV, Y = roughness
   let NdotV = input.vUv.x;
   let roughness = input.vUv.y;
   
   // Clamp NdotV to avoid division by zero
   let clampedNdotV = max(NdotV, 0.001);
   
   // Clamp roughness to avoid perfectly smooth (causes issues)
   let clampedRoughness = max(roughness, 0.01);
   
   let result = integrateBRDF(clampedNdotV, clampedRoughness, u32(local.sampleCount));
   
   return vec4<f32>(result.x, result.y, 0.0, 1.0);
}
`,
};
