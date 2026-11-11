import { Matrix, Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { passBitRegistry } from '~/core/render-passes/passBitRegistry';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { uvTransformBit } from '~/core/shader/bits/uvTransformBit';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PortalMaterial } from '~/extras/materials/portal/PortalMaterial';
import type { PortalMaterialOptions } from '~/extras/materials/portal/PortalMaterial';
import { ToonMaterial } from '~/extras/materials/toon/ToonMaterial';
import type { ToonMaterialOptions } from '~/extras/materials/toon/ToonMaterial';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import type { BaseMaterial3DOptions } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DOptions } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import type { PhongMaterialOptions } from '~/materials/phong/PhongMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { ParticleMaterial } from '~/scene/particles/ParticleMaterial';
import type { ParticleMaterialOptions } from '~/scene/particles/ParticleMaterial';

const makeTexture = () => new Texture({ source: new TextureSource({ width: 1, height: 1 }) });

const userFloatAndSlotBit: ShaderBit = {
  name: 'cloneTestTint',
  bindings: { material: { cloneMix: 'f32' } },
  textures: ['cloneMask'],
};

const userVec3BitShiftingLaterFields: ShaderBit = {
  name: 'cloneTestVec',
  bindings: { material: { cloneVec: 'vec3<f32>' } },
  textures: ['cloneVecMask'],
};

const rawMaterialOwnBit: ShaderBit = {
  name: 'cloneTestRaw',
  bindings: { material: { baseColor: 'vec4<f32>', alphaCutoff: 'f32', rawFlags: 'u32', rawScale: 'f32' } },
  textures: ['baseColor', 'rawMask'],
};

const rawDescriptor = { bitsGpu: [rawMaterialOwnBit, uvTransformBit], bitsGl: [rawMaterialOwnBit, uvTransformBit] };

class NoOptionsUserMaterial extends BaseMaterial3D {
  constructor() {
    super({ descriptor: { bitsGpu: [userFloatAndSlotBit], bitsGl: [userFloatAndSlotBit] } });
  }
}

function everyOptionInColoursBetween8BitSteps(): Required<Material3DOptions> {
  return {
    label: 'cloneTestPaint',
    baseColor: [0.1234, 0.5678, 0.9012],
    alpha: 0.8125,
    baseColorTexture: makeTexture(),
    textures: { cloneMask: makeTexture() },
    extraBits: [userFloatAndSlotBit],
    alphaMode: 'mask',
    alphaCutoff: 0.3,
    doubleSided: true,
    flatShading: true,
    fog: false,
    vertexColors: true,
    passes: { outline: true },
    topology: 'line-list',
    uvTransform: new Matrix().scale(2, 3).rotate(0.3).translate(0.1, 0.2),
    normalTexture: makeTexture(),
    normalScale: 0.7,
    roughness: 0.33,
    metallic: 0.66,
    metallicRoughnessTexture: makeTexture(),
    occlusionTexture: makeTexture(),
    occlusionStrength: 0.9,
    ior: 1.45,
    emissive: { color: [0.31, 0.62, 0.93], strength: 2.5, texture: makeTexture() },
    specular: { factor: 0.4, color: [0.21, 0.32, 0.43], texture: makeTexture(), colorTexture: makeTexture() },
    iridescence: {
      factor: 0.6,
      ior: 1.4,
      thicknessMinimum: 120,
      thicknessMaximum: 480,
      texture: makeTexture(),
      thicknessTexture: makeTexture(),
    },
    transmission: {
      factor: 0.7,
      texture: makeTexture(),
      thickness: 0.4,
      thicknessTexture: makeTexture(),
      attenuationDistance: 2,
      attenuationColor: [0.71, 0.22, 0.13],
    },
    clearcoat: {
      factor: 0.5,
      roughness: 0.2,
      normalScale: 0.8,
      texture: makeTexture(),
      roughnessTexture: makeTexture(),
      normalTexture: makeTexture(),
    },
    sheen: { color: [0.91, 0.41, 0.61], roughness: 0.3, texture: makeTexture(), roughnessTexture: makeTexture() },
    anisotropy: { strength: 0.6, rotation: 0.4, texture: makeTexture() },
  };
}

const isProps = (value: unknown, material: BaseMaterial3D): value is object =>
  typeof value === 'object' && value !== null && (value as { _material?: unknown })._material === material;

function comparableByContent(value: unknown): unknown {
  if (value instanceof Texture) return `texture ${value.uid}`;
  if (value instanceof Matrix) return [value.a, value.b, value.c, value.d, value.tx, value.ty];
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'object' && item && 'name' in item ? item.name : comparableByContent(item),
    );
  }

  return value;
}

function everyGetterValue(target: object, propsOwner?: BaseMaterial3D): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let proto = Object.getPrototypeOf(target); proto && proto !== Object.prototype;) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name in out || !Object.getOwnPropertyDescriptor(proto, name)?.get) continue;
      out[name] = comparableByContent((target as Record<string, unknown>)[name]);
    }
    proto = Object.getPrototypeOf(proto);
  }

  if (propsOwner) {
    for (const [key, value] of Object.entries(target)) {
      if (value === propsOwner.data || value === propsOwner.textures || !isProps(value, propsOwner)) continue;
      out[key] = everyGetterValue(value);
    }
  }

  return out;
}

function namesInLayoutOrder(dataOrTextures: object): string[] {
  const names: string[] = [];
  for (const name in dataOrTextures) if (!name.startsWith('_')) names.push(name);

  return names;
}

function dataAsNumberLists(material: BaseMaterial3D): Record<string, number[]> {
  const data = material.data as Record<string, number | Float32Array>;

  return Object.fromEntries(
    namesInLayoutOrder(data).map((name) => {
      const value = data[name];

      return [name, typeof value === 'number' ? [value] : [...value]];
    }),
  );
}

const geometry = new PlaneGeometry();

const passesOf = (material: BaseMaterial3D) => new Mesh3D({ geometry, material }).renderPassMask;

function expectDrawsLike(copy: BaseMaterial3D, source: BaseMaterial3D): void {
  expect(copy).not.toBe(source);
  expect(copy.constructor).toBe(source.constructor);
  expect(copy.extraBits.map((bit) => bit.name)).toEqual(source.extraBits.map((bit) => bit.name));

  const copyData = dataAsNumberLists(copy);
  const sourceData = dataAsNumberLists(source);

  expect(Object.keys(copyData)).toEqual(Object.keys(sourceData));
  for (const name in sourceData) {
    copyData[name].forEach((value, i) =>
      expect(
        Math.abs(value - sourceData[name][i]),
        `data.${name}[${i}], as close as a colour read back in 8 bits`,
      ).toBeLessThan(0.01),
    );
  }

  expect(namesInLayoutOrder(copy.textures)).toEqual(namesInLayoutOrder(source.textures));
  for (const name of namesInLayoutOrder(source.textures)) expect(copy.textures[name], name).toBe(source.textures[name]);

  expect(everyGetterValue(copy, copy)).toEqual(everyGetterValue(source, source));

  expect(passesOf(copy)).toBe(passesOf(source));
  expect(copy.state).not.toBe(source.state);
  expect(copy.state.data).toBe(source.state.data);
  expect(copy.state.blendMode).toBe(source.state.blendMode);
  expect(copy.state.polygonOffset).toBe(source.state.polygonOffset);

  for (const flag of [
    'label',
    'doubleSided',
    'flatShading',
    'fog',
    'topology',
    'vertexColors',
    'colorSpace',
    'lit',
  ] as const) {
    expect(copy[flag], flag).toBe(source[flag]);
  }

  expect(comparableByContent(copy.uvTransform)).toEqual(comparableByContent(source.uvTransform));
}

describe('BaseMaterial3D.clone', () => {
  it('copies the values as they are now, not as they were built', () => {
    const source = new Material3D(everyOptionInColoursBetween8BitSteps());
    const replaced = source.textures.baseColor;

    source.baseColor = [0.25, 0.5, 0.7501];
    source.emissive!.color = [0.11, 0.22, 0.33];
    source.data.pbrParams = new Float32Array([0.1, 0.2, 0.3, 1.6]);
    source.data.cloneMix = 0.123;
    source.textures.baseColor = makeTexture();
    replaced.destroy();
    source.enablePass('cloneTestPass');
    source.state.depthTest = false;
    source.state.polygonOffset = 2;
    source.uvTransform = new Matrix().translate(0.5, 0.25);
    source.uvTransform = undefined;
    source.vertexColors = false;
    source.colorSpace = 'display';
    source.lit = false;

    expectDrawsLike(source.clone(), source);
  });

  it('keeps deriving the UV transform from a framed base colour texture', () => {
    const sheet = new TextureSource({ width: 4, height: 4 });
    const source = new Material3D({
      baseColorTexture: new Texture({ source: sheet, frame: new Rectangle(0, 0, 2, 2) }),
    });
    const copy = source.clone();

    expectDrawsLike(copy, source);
    expect([...copy.data.uvTransformRow0!]).toEqual([0.5, 0, 0, 0.5]);

    copy.textures.baseColor = new Texture({ source: sheet, frame: new Rectangle(2, 2, 2, 2) });

    expect([...copy.data.uvOffset!]).toEqual([0.5, 0.5]);
    expect([...source.data.uvOffset!]).toEqual([0, 0]);
  });

  it('adds a bit whose field starts at 0 and slot holds white, keeping every other value', () => {
    const source = new Material3D({
      baseColor: 0x3366ff,
      metallic: 0.66,
      emissive: { color: 0xff8000, strength: 2.5 },
      uvTransform: new Matrix().scale(2, 3),
      extraBits: [userFloatAndSlotBit],
    });
    source.data.cloneMix = 0.25;
    const copy = source.clone({ extraBits: [userVec3BitShiftingLaterFields] });

    expect([...(copy.data.cloneVec as Float32Array)]).toEqual([0, 0, 0]);
    expect(copy.textures.cloneVecMask).toBe(Texture.WHITE);
    expect(copy.data.cloneMix).toBe(0.25);
    expect([copy.baseColor, copy.metallic, copy.emissive!.color, copy.emissive!.strength]).toEqual([
      0x3366ff,
      expect.closeTo(0.66),
      0xff8000,
      2.5,
    ]);
    expect(source.extraBits).toEqual([userFloatAndSlotBit]);
  });

  it('adds bits after the ones the material has, skipping one it already has', () => {
    const source = new Material3D({ extraBits: [userFloatAndSlotBit] });
    const copy = source.clone({ extraBits: [userVec3BitShiftingLaterFields, userFloatAndSlotBit] });

    expect(copy.extraBits).toEqual([userFloatAndSlotBit, userVec3BitShiftingLaterFields]);
    expect(source.extraBits).toEqual([userFloatAndSlotBit]);
  });

  it('makes a copy that shares nothing with its source but the textures, both ways', () => {
    const source = new Material3D({ baseColorTexture: makeTexture(), extraBits: [userFloatAndSlotBit] });
    const copy = source.clone();
    const snapshot = (material: Material3D) => [
      dataAsNumberLists(material),
      material.textures.baseColor,
      material.alphaMode,
      material.state.data,
      passesOf(material),
    ];

    for (const [written, other] of [
      [copy, source],
      [source, copy],
    ]) {
      const untouched = snapshot(other);
      written.data.pbrParams = new Float32Array([0.9, 0.8, 0.7, 1.2]);
      written.data.cloneMix = 0.5;
      written.textures.baseColor = makeTexture();
      written.alphaMode = written.alphaMode === 'blend' ? 'opaque' : 'blend';
      written.state.depthTest = !written.state.depthTest;
      written.enablePass(`cloneIndependence${written.uid}`);

      expect(snapshot(other)).toEqual(untouched);
    }
  });

  type EveryOptionTheSubclassAdds<T> = Required<Omit<T, keyof BaseMaterial3DOptions>>;

  const phong: EveryOptionTheSubclassAdds<PhongMaterialOptions> = {
    specularColor: [0.31, 0.22, 0.13],
    shininess: 50,
    specularStrength: 0.4,
    specularTexture: makeTexture(),
    normalTexture: makeTexture(),
    normalScale: 0.6,
    emissive: { color: [0.5, 0.25, 0.126], strength: 3, texture: makeTexture() },
  };
  const toon: EveryOptionTheSubclassAdds<ToonMaterialOptions> = {
    bands: 2,
    specularSize: 0.3,
    rimPower: 5,
    rimIntensity: 0.7,
    outline: false,
  };
  const particle: EveryOptionTheSubclassAdds<ParticleMaterialOptions> = {
    texture: makeTexture(),
    billboard: 'cylindrical',
    useFrames: true,
    localSpace: true,
    blendMode: 'add',
  };
  const portal: EveryOptionTheSubclassAdds<PortalMaterialOptions> = { texture: makeTexture() };
  const base = {
    label: 'cloneTestBase',
    baseColor: [0.2, 0.4, 0.61],
    alpha: 0.75,
    alphaMode: 'mask',
    alphaCutoff: 0.2,
  } as const;
  const fogSetSinceACopyDoesntDeriveItFromBlendMode = { fog: false };

  const classesAwayFromDefaults: { name: string; build: (options?: object) => BaseMaterial3D; options: object }[] = [
    { name: 'Material3D', build: (o) => new Material3D(o), options: everyOptionInColoursBetween8BitSteps() },
    {
      name: 'FlatMaterial',
      build: (o) => new FlatMaterial(o),
      options: { ...base, baseColorTexture: makeTexture(), extraBits: [userFloatAndSlotBit], doubleSided: true },
    },
    { name: 'PhongMaterial', build: (o) => new PhongMaterial(o), options: { ...base, ...phong } },
    { name: 'ToonMaterial', build: (o) => new ToonMaterial(o), options: { ...base, ...toon } },
    { name: 'PortalMaterial', build: (o) => new PortalMaterial(o), options: { ...base, ...portal } },
    {
      name: 'ParticleMaterial',
      build: (o) => new ParticleMaterial(o),
      options: { ...particle, label: 'cloneTestSpark', ...fogSetSinceACopyDoesntDeriveItFromBlendMode },
    },
  ];

  for (const { name, build, options } of classesAwayFromDefaults) {
    it(`copies a ${name} built away from its defaults, and a default ${name} cloned with those options draws the same`, () => {
      const source = build(options);

      expectDrawsLike(source.clone(), source);
      expectDrawsLike(build().clone(options), source);
    });
  }

  describe('of a material whose class keeps the base _toOptions', () => {
    function rawMaterialAwayFromDefaults(): BaseMaterial3D {
      const source = new BaseMaterial3D({
        descriptor: rawDescriptor,
        baseColor: 0xff0000,
        alphaCutoff: 0.7,
        uvTransform: new Matrix().scale(3, 3).translate(0.5, 0.25),
        baseColorTexture: makeTexture(),
      });
      source.data.rawFlags = 5;
      source.data.rawScale = 0.375;
      source.textures.rawMask = makeTexture();

      return source;
    }

    it('copies every field and texture slot a raw-descriptor material has', () => {
      const source = rawMaterialAwayFromDefaults();
      expectDrawsLike(source.clone(), source);
    });

    it('lets the options passed win over the fields and slots it copies', () => {
      const source = rawMaterialAwayFromDefaults();
      const baseColorTexture = makeTexture();
      const rawMask = makeTexture();
      const copy = source.clone({
        baseColor: 0x00ff00,
        alpha: 0.4,
        alphaCutoff: 0.2,
        uvTransform: new Matrix().scale(2, 2),
        baseColorTexture,
        textures: { rawMask },
      });

      expect([...copy.data.baseColor!]).toEqual([0, 1, 0, expect.closeTo(0.4)]);
      expect(copy.data.alphaCutoff).toBeCloseTo(0.2);
      expect([...copy.data.uvTransformRow0!, ...copy.data.uvOffset!]).toEqual([2, 0, 0, 2, 0, 0]);
      expect(copy.textures.baseColor).toBe(baseColorTexture);
      expect(copy.textures.rawMask).toBe(rawMask);
      expect([copy.data.rawFlags, copy.data.rawScale]).toEqual([5, 0.375]);
    });

    it('keeps every value when it adds a bit, whose field starts at 0 and slot holds white', () => {
      const source = rawMaterialAwayFromDefaults();
      const copy = source.clone({ extraBits: [userVec3BitShiftingLaterFields] });

      expect([copy.data.rawFlags, copy.data.rawScale, ...(copy.data.cloneVec as Float32Array)]).toEqual([
        5, 0.375, 0, 0, 0,
      ]);
      expect(copy.textures.rawMask).toBe(source.textures.rawMask);
      expect(copy.textures.cloneVecMask).toBe(Texture.WHITE);
    });

    it('copies the fields and slots of a subclass whose constructor takes no options', () => {
      const source = new NoOptionsUserMaterial();
      source.data.cloneMix = 0.25;
      source.textures.cloneMask = makeTexture();

      expectDrawsLike(source.clone(), source);
    });
  });

  describe('with options', () => {
    it("takes each class's own constructor options", () => {
      expectTypeOf<Parameters<Material3D['clone']>[0]>().toEqualTypeOf<Material3DOptions | undefined>();
      expectTypeOf<Parameters<ToonMaterial['clone']>[0]>().toEqualTypeOf<ToonMaterialOptions | undefined>();

      // @ts-expect-error roughness is a Material3D option, not a FlatMaterial one
      new FlatMaterial().clone({ roughness: 0.2 });
      // @ts-expect-error bands is a ToonMaterial option
      new PhongMaterial().clone({ bands: 2 });
    });

    it('changes a feature group the material has, keeping what the group left out or set to undefined', () => {
      const source = new Material3D({ emissive: { color: [0.31, 0.62, 0.93], strength: 2.5 } });
      const copy = source.clone({ emissive: { strength: 4, color: undefined } });

      expect(copy.emissive!.strength).toBe(4);
      expect(copy.emissive!.color).toBe(source.emissive!.color);
      [...copy.data.emissive!].forEach((value, i) => expect(value).toBeCloseTo(source.data.emissive![i], 2));
      expect(source.emissive!.strength).toBe(2.5);
    });

    it('wins over state the source took after it was built, and leaves out what is undefined', () => {
      const source = new Material3D({ roughness: 0.5, metallic: 0.25 });
      source.roughness = 0.9;
      source.metallic = 0.75;

      const copy = source.clone({ roughness: 0.2, metallic: undefined });

      expect(copy.roughness).toBeCloseTo(0.2);
      expect(copy.metallic).toBeCloseTo(0.75);
    });

    it('keeps a transmissive material and its copies in the transmission pass alone and the passes they joined', () => {
      const joined = new Material3D();
      joined.enablePass('cloneTestPass');
      const source = new Material3D({ transmission: { factor: 1 }, passes: { cloneTestPass: true } });
      const passes = RenderPassBit.TRANSMISSION | passBitRegistry.get('cloneTestPass')!;

      expect(
        [
          source,
          source.clone({ alphaMode: 'blend' }),
          joined.clone({ transmission: { factor: 1 } }),
          joined.clone({ transmission: { factor: 1 }, alphaMode: 'blend' }),
        ].map(passesOf),
      ).toEqual([passes, passes, passes, passes]);
    });

    it('keeps state changed on the source, except the flags an option passed sets', () => {
      const source = new Material3D();
      source.state.depthTest = false;
      const copy = source.clone({ alphaMode: 'blend', doubleSided: true });

      expect([copy.state.depthTest, copy.state.blend, copy.state.depthMask, copy.state.culling]).toEqual([
        false,
        true,
        false,
        false,
      ]);
    });

    it('changes only the passes it names', () => {
      const source = new ToonMaterial({ passes: { cloneTestPass: true } });
      const copy = source.clone({ passes: { outline: false } });

      expect(passesOf(copy)).toBe(passesOf(new ToonMaterial({ outline: false, passes: { cloneTestPass: true } })));
      expect(passesOf(copy)).not.toBe(passesOf(source));
    });
  });
});
