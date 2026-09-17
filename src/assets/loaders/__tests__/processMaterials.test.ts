import { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import type { KHRTextureTransform, Material } from '~/assets/loaders/gltf/GltfFormat';
import { processMaterial } from '~/assets/loaders/gltf/process/processMaterials';
import { Scene3DSource } from '~/assets/Scene3DSource';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';

function makeSource(textures: Texture[] = [Texture.WHITE]): Scene3DSource {
  const source = new Scene3DSource({});
  // Scene3DSource.textures is `readonly` but the field itself is mutable in-place.
  for (let i = 0; i < textures.length; i++) source.textures[i] = textures[i];
  return source;
}

describe('processMaterial — KHR_materials_unlit', () => {
  it('returns a FlatMaterial when the extension is present, honouring spec fields', () => {
    const source = makeSource();
    const baseColorTexture = Texture.WHITE;
    const raw: Material = {
      name: 'Unlit',
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
        baseColorTexture: { index: 0 },
      },
      doubleSided: true,
      alphaMode: 'MASK',
      alphaCutoff: 0.3,
    };

    const material = processMaterial(raw, source);

    expect(material).toBeInstanceOf(FlatMaterial);
    const flat = material as FlatMaterial;
    expect(flat.baseColor).toBe(0xff0000);
    expect(flat.alpha).toBe(1);
    expect(flat.textures.baseColor).toBe(baseColorTexture);
    expect(flat.doubleSided).toBe(true);
    expect(flat.alphaMode).toBe('mask');
    expect(flat.alphaCutoff).toBe(0.3);
  });

  it('returns a Material3D when the extension is absent (PBR regression guard)', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'Pbr',
      pbrMetallicRoughness: {
        metallicFactor: 0.7,
        roughnessFactor: 0.4,
      },
    };

    const material = processMaterial(raw, source);

    expect(material).toBeInstanceOf(Material3D);
    const pbr = material as Material3D;
    expect(pbr.metallic).toBeCloseTo(0.7);
    expect(pbr.roughness).toBeCloseTo(0.4);
  });

  it('ignores PBR-only fields and other KHR extensions on an unlit material (per spec)', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'UnlitWithIgnoredFields',
      extensions: {
        KHR_materials_unlit: {},
        KHR_materials_ior: { ior: 1.7 },
        KHR_materials_transmission: { transmissionFactor: 0.5 },
      },
      pbrMetallicRoughness: {
        baseColorFactor: [0, 1, 0, 1],
        metallicFactor: 0.8,
        roughnessFactor: 0.2,
      },
      normalTexture: { index: 0 },
      emissiveFactor: [1, 1, 1],
      emissiveTexture: { index: 0 },
      occlusionTexture: { index: 0, strength: 0.5 },
    };

    const material = processMaterial(raw, source);

    // FlatMaterial has none of the PBR-only getters, so reaching this assertion
    // implicitly proves the unlit path didn't try to set metallic/normalTexture/etc.
    expect(material).toBeInstanceOf(FlatMaterial);
    expect(material).not.toBeInstanceOf(Material3D);
    const flat = material as FlatMaterial;
    expect(flat.baseColor).toBe(0x00ff00);
  });
});

describe('processMaterial — KHR_materials_specular', () => {
  it('reads specularFactor from the extension into Material3D.specularFactor', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'SpecFactor',
      extensions: {
        KHR_materials_specular: { specularFactor: 0.25 },
      },
    };

    const material = processMaterial(raw, source);

    expect(material).toBeInstanceOf(Material3D);
    expect((material as Material3D).specular!.factor).toBeCloseTo(0.25);
  });

  it('reads specularColorFactor from the extension into Material3D.specularColor', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'SpecTint',
      extensions: {
        KHR_materials_specular: { specularColorFactor: [1, 0.5, 0] },
      },
    };

    const material = processMaterial(raw, source);
    const mat = material as Material3D;

    const specularParams = mat.data.specularParams!;
    expect(specularParams[0]).toBeCloseTo(1);
    expect(specularParams[1]).toBeCloseTo(0.5);
    expect(specularParams[2]).toBeCloseTo(0, 5);
  });

  it('resolves specularTexture and specularColorTexture indices against the source textures', () => {
    const tex0 = Texture.WHITE;
    const tex1 = Texture.EMPTY;
    const source = makeSource([tex0, tex1]);
    const raw: Material = {
      name: 'SpecTextures',
      extensions: {
        KHR_materials_specular: {
          specularTexture: { index: 0 },
          specularColorTexture: { index: 1 },
        },
      },
    };

    const material = processMaterial(raw, source) as Material3D;

    // Pack-into-one-slot: the colour texture wins (see constructor fallback).
    expect(material.specular!.texture).toBe(tex1);
  });

  it('defaults specularFactor to 1 per spec when the extension omits it', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'SpecDefault',
      extensions: { KHR_materials_specular: { specularColorFactor: [1, 1, 1] } },
    };

    const material = processMaterial(raw, source);
    expect((material as Material3D).specular!.factor).toBe(1);
  });

  it('leaves specular disabled when the extension is absent', () => {
    const source = makeSource();
    const raw: Material = { name: 'NoSpec' };

    const material = processMaterial(raw, source) as Material3D;
    expect(material.data.specularParams).toBeUndefined();
    expect(material.specular).toBeUndefined();
  });
});

describe('processMaterial — KHR_materials_anisotropy', () => {
  it('reads anisotropyStrength and anisotropyRotation into Material3D.anisotropy', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'Aniso',
      extensions: {
        KHR_materials_anisotropy: { anisotropyStrength: 0.5, anisotropyRotation: 1.25 },
      },
    };

    const material = processMaterial(raw, source);

    expect(material).toBeInstanceOf(Material3D);
    const mat = material as Material3D;
    expect(mat.anisotropy!.strength).toBeCloseTo(0.5);
    expect(mat.anisotropy!.rotation).toBeCloseTo(1.25);
    // Packed: strength → lane 0, rotation → lane 1.
    expect(mat.data.anisotropyParams![0]).toBeCloseTo(0.5);
    expect(mat.data.anisotropyParams![1]).toBeCloseTo(1.25);
  });

  it('resolves anisotropyTexture index against the source textures', () => {
    const tex0 = Texture.WHITE;
    const tex1 = Texture.EMPTY;
    const source = makeSource([tex0, tex1]);
    const raw: Material = {
      name: 'AnisoTex',
      extensions: {
        KHR_materials_anisotropy: { anisotropyStrength: 1, anisotropyTexture: { index: 1 } },
      },
    };

    const material = processMaterial(raw, source) as Material3D;
    expect(material.anisotropy!.texture).toBe(tex1);
  });

  it('defaults strength and rotation to 0 per spec when the extension omits them', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'AnisoDefault',
      extensions: { KHR_materials_anisotropy: {} },
    };

    const material = processMaterial(raw, source) as Material3D;
    expect(material.anisotropy!.strength).toBe(0);
    expect(material.anisotropy!.rotation).toBe(0);
  });

  it('leaves anisotropy disabled when the extension is absent', () => {
    const source = makeSource();
    const raw: Material = { name: 'NoAniso' };

    const material = processMaterial(raw, source) as Material3D;
    expect(material.data.anisotropyParams).toBeUndefined();
    expect(material.anisotropy).toBeUndefined();
  });
});

describe('processMaterial — KHR_materials_emissive_strength', () => {
  it('reads emissiveStrength from the extension into Material3D.emissiveStrength', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'EmissiveStrong',
      emissiveFactor: [1, 1, 1],
      extensions: {
        KHR_materials_emissive_strength: { emissiveStrength: 5 },
      },
    };

    const material = processMaterial(raw, source);

    expect(material).toBeInstanceOf(Material3D);
    expect((material as Material3D).emissive!.strength).toBe(5);
  });

  it('defaults emissiveStrength to 1 per spec when the extension omits emissiveStrength', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'EmissiveDefault',
      emissiveFactor: [1, 1, 1],
      extensions: { KHR_materials_emissive_strength: {} },
    };

    const material = processMaterial(raw, source);
    expect((material as Material3D).emissive!.strength).toBe(1);
  });

  it('leaves emissiveStrength at the Material3D default of 1 when the extension is absent', () => {
    const source = makeSource();
    const raw: Material = { name: 'NoExt', emissiveFactor: [1, 0, 0] };

    const material = processMaterial(raw, source);
    expect((material as Material3D).emissive!.strength).toBe(1);
  });
});

describe('processMaterial — alphaMode coercion under transmission', () => {
  // See processMaterials.ts: alphaMode BLEND/MASK + transmission is undefined in
  // the spec, and leaving state.blend/depthMask on in the transmission pass
  // produces striping on doubleSided meshes (front/back triangles with no depth
  // writes). Coercing to OPAQUE matches the Khronos sample renderer.

  it('coerces alphaMode from BLEND to opaque when transmission is present', () => {
    const source = makeSource();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw: Material = {
      name: 'BlendTransmission',
      alphaMode: 'BLEND',
      extensions: { KHR_materials_transmission: { transmissionFactor: 0.5 } },
    };

    const material = processMaterial(raw, source) as Material3D;

    expect(material.alphaMode).toBe('opaque');
    expect(material.transmission!.factor).toBeCloseTo(0.5);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('coerces alphaMode from MASK to opaque when transmission is present', () => {
    const source = makeSource();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw: Material = {
      name: 'MaskTransmission',
      alphaMode: 'MASK',
      extensions: { KHR_materials_transmission: { transmissionFactor: 0.3 } },
    };

    const material = processMaterial(raw, source) as Material3D;

    expect(material.alphaMode).toBe('opaque');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('leaves OPAQUE alphaMode untouched and emits no warning', () => {
    const source = makeSource();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw: Material = {
      name: 'OpaqueTransmission',
      alphaMode: 'OPAQUE',
      extensions: { KHR_materials_transmission: { transmissionFactor: 0.4 } },
    };

    const material = processMaterial(raw, source) as Material3D;

    expect(material.alphaMode).toBe('opaque');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not coerce BLEND when transmissionFactor is 0 and no transmission texture is set', () => {
    const source = makeSource();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw: Material = {
      name: 'BlendNoTransmission',
      alphaMode: 'BLEND',
      extensions: { KHR_materials_transmission: { transmissionFactor: 0 } },
    };

    const material = processMaterial(raw, source) as Material3D;

    expect(material.alphaMode).toBe('blend');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('coerces BLEND when only a transmissionTexture is supplied (no factor)', () => {
    const source = makeSource();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw: Material = {
      name: 'BlendTransmissionTex',
      alphaMode: 'BLEND',
      extensions: { KHR_materials_transmission: { transmissionTexture: { index: 0 } } },
    };

    const material = processMaterial(raw, source) as Material3D;

    expect(material.alphaMode).toBe('opaque');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('processMaterial — KHR_texture_transform extraction', () => {
  // pixi-3d uses a single-per-material UV transform. The loader scans every
  // texture slot it forwards to Material3D; whichever slot declares the
  // extension first contributes the transform for the whole material. This
  // guards against silently dropping the transform when it's only declared
  // on an extension slot (e.g. clearcoat-only).

  const ktt = (offset: [number, number]): { KHR_texture_transform: KHRTextureTransform } => ({
    KHR_texture_transform: { offset, scale: [1, 1], rotation: 0 },
  });

  function expectOffset(material: Material3D, x: number, y: number): void {
    expect(material.uvTransform).toBeDefined();
    expect(material.uvTransform!.tx).toBeCloseTo(x);
    expect(material.uvTransform!.ty).toBeCloseTo(y);
  }

  it('picks up the transform from baseColorTexture (regression guard for core slots)', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'BaseColorKtt',
      pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: ktt([0.1, 0.2]) } },
    };
    const material = processMaterial(raw, source) as Material3D;
    expectOffset(material, 0.1, 0.2);
  });

  it('picks up the transform from a clearcoat slot when no core slot declares one', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'ClearcoatKtt',
      extensions: {
        KHR_materials_clearcoat: {
          clearcoatFactor: 1,
          clearcoatTexture: { index: 0, extensions: ktt([0.3, 0.4]) },
        },
      },
    };
    const material = processMaterial(raw, source) as Material3D;
    expectOffset(material, 0.3, 0.4);
  });

  it('picks up the transform from clearcoatRoughnessTexture when it is the only declarer', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'ClearcoatRoughKtt',
      extensions: {
        KHR_materials_clearcoat: {
          clearcoatFactor: 1,
          clearcoatRoughnessTexture: { index: 0, extensions: ktt([0.5, 0.6]) },
        },
      },
    };
    const material = processMaterial(raw, source) as Material3D;
    expectOffset(material, 0.5, 0.6);
  });

  it('picks up the transform from clearcoatNormalTexture when it is the only declarer', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'ClearcoatNormalKtt',
      extensions: {
        KHR_materials_clearcoat: {
          clearcoatFactor: 1,
          clearcoatNormalTexture: { index: 0, extensions: ktt([0.7, 0.8]) },
        },
      },
    };
    const material = processMaterial(raw, source) as Material3D;
    expectOffset(material, 0.7, 0.8);
  });

  it('picks up the transform from transmission/volume/sheen/specular/iridescence slots', () => {
    const cases: { raw: Material; expected: [number, number] }[] = [
      {
        raw: {
          name: 't',
          extensions: {
            KHR_materials_transmission: {
              transmissionFactor: 0.5,
              transmissionTexture: { index: 0, extensions: ktt([0.11, 0]) },
            },
          },
        },
        expected: [0.11, 0],
      },
      {
        raw: {
          name: 'v',
          extensions: {
            KHR_materials_volume: { thicknessTexture: { index: 0, extensions: ktt([0.22, 0]) } },
          },
        },
        expected: [0.22, 0],
      },
      {
        raw: {
          name: 's',
          extensions: {
            KHR_materials_sheen: {
              sheenColorFactor: [1, 1, 1],
              sheenColorTexture: { index: 0, extensions: ktt([0.33, 0]) },
            },
          },
        },
        expected: [0.33, 0],
      },
      {
        raw: {
          name: 'sp',
          extensions: {
            KHR_materials_specular: {
              specularColorTexture: { index: 0, extensions: ktt([0.44, 0]) },
            },
          },
        },
        expected: [0.44, 0],
      },
      {
        raw: {
          name: 'i',
          extensions: {
            KHR_materials_iridescence: {
              iridescenceFactor: 1,
              iridescenceTexture: { index: 0, extensions: ktt([0.55, 0]) },
            },
          },
        },
        expected: [0.55, 0],
      },
    ];

    for (const { raw, expected } of cases) {
      const material = processMaterial(raw, makeSource()) as Material3D;
      expectOffset(material, expected[0], expected[1]);
    }
  });

  it('leaves uvTransform undefined when no slot declares KHR_texture_transform', () => {
    const source = makeSource();
    const raw: Material = {
      name: 'NoKtt',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
    };
    const material = processMaterial(raw, source) as Material3D;
    expect(material.uvTransform).toBeUndefined();
  });
});

describe('processMaterial — glTF linear factor colours', () => {
  // glTF factors are linear per spec; the loader pre-encodes them to sRGB so
  // the material's display-space decode lands the spec value on the GPU.
  it('round-trips emissiveFactor onto the GPU at its spec value', () => {
    const raw: Material = { name: 'Emissive', emissiveFactor: [0.1, 0.5, 0.9] };
    const material = processMaterial(raw, makeSource()) as Material3D;

    const emissive = material.data.emissive!;
    expect(emissive[0]).toBeCloseTo(0.1, 5);
    expect(emissive[1]).toBeCloseTo(0.5, 5);
    expect(emissive[2]).toBeCloseTo(0.9, 5);
  });

  it('round-trips baseColorFactor rgb; alpha passes through untouched', () => {
    const raw: Material = {
      name: 'Base',
      pbrMetallicRoughness: { baseColorFactor: [0.1, 0.5, 0.9, 0.25] },
    };
    const material = processMaterial(raw, makeSource()) as Material3D;

    const baseColor = material.data.baseColor;
    expect(baseColor[0]).toBeCloseTo(0.1, 5);
    expect(baseColor[1]).toBeCloseTo(0.5, 5);
    expect(baseColor[2]).toBeCloseTo(0.9, 5);
    expect(baseColor[3]).toBe(0.25);
  });

  it('round-trips attenuationColor, sheenColorFactor and specularColorFactor', () => {
    const raw: Material = {
      name: 'Tints',
      extensions: {
        KHR_materials_transmission: { transmissionFactor: 1 },
        KHR_materials_volume: { attenuationColor: [0.2, 0.6, 0.8] },
        KHR_materials_sheen: { sheenColorFactor: [0.25, 0.5, 0.75] },
        KHR_materials_specular: { specularColorFactor: [0.3, 0.6, 0.9] },
      },
    };
    const material = processMaterial(raw, makeSource()) as Material3D;

    const attenuationColorIrid = material.data.attenuationColorIrid!;
    const sheenParams = material.data.sheenParams!;
    const specularParams = material.data.specularParams!;
    expect(attenuationColorIrid[0]).toBeCloseTo(0.2, 5);
    expect(attenuationColorIrid[1]).toBeCloseTo(0.6, 5);
    expect(attenuationColorIrid[2]).toBeCloseTo(0.8, 5);
    expect(sheenParams[0]).toBeCloseTo(0.25, 5);
    expect(sheenParams[1]).toBeCloseTo(0.5, 5);
    expect(sheenParams[2]).toBeCloseTo(0.75, 5);
    expect(specularParams[0]).toBeCloseTo(0.3, 5);
    expect(specularParams[1]).toBeCloseTo(0.6, 5);
    expect(specularParams[2]).toBeCloseTo(0.9, 5);
  });
});
