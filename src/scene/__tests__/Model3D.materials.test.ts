import { describe, expect, it, vi } from 'vitest';

import { Scene3DSource } from '~/assets/Scene3DSource';
import { Geometry3D } from '~/geometry/Geometry3D';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';

const triangle = () => new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) });

function createSourceLikeALoadedFile(): Scene3DSource {
  const source = new Scene3DSource({
    scenes: [{ children: [0, 1, 2] }],
    nodes: [
      { label: 'Body', children: [], geometry: 0, materials: [0] },
      { label: 'Visor', children: [], geometry: 1, materials: [1, 2] },
      { label: 'Trim', children: [], geometry: 2, materials: [0] },
    ],
  });

  source.geometries[0] = [triangle()];
  source.geometries[1] = [triangle(), triangle()];
  source.geometries[2] = [triangle()];
  source.materials.push(
    new Material3D({ label: 'Paint', baseColor: 0x336699 }),
    new FlatMaterial({ label: 'Glass', baseColor: 0xffcc00 }),
    new Material3D({ label: 'Paint', baseColor: 0x993333 }),
    new Material3D(),
  );

  return source;
}

function meshesInBuildOrder(model: Model3D): Mesh3D[] {
  const out: Mesh3D[] = [];
  model.traverse((node) => {
    if (node instanceof Mesh3D) out.push(node);
  });

  return out;
}

const drawn = (model: Model3D) => meshesInBuildOrder(model).map((mesh) => mesh.material);

describe('Model3D materials', () => {
  it('replaces every material with a label in the record, including two with the same label, and keeps the rest', () => {
    const source = createSourceLikeALoadedFile();
    const red = new Material3D({ baseColor: 0xff0000 });
    const model = new Model3D({ source, materials: { Paint: red } });

    expect(drawn(model), "Body, the Visor's Glass and second Paint, then Trim").toEqual([
      red,
      source.materials[1],
      red,
      red,
    ]);
    expect(model.materials, 'Paint, Glass, the second Paint, then the unnamed material').toEqual([
      red,
      source.materials[1],
      red,
      source.materials[3],
    ]);
  });

  it('replaces by index from an array, keeping the source material for an empty entry', () => {
    const source = createSourceLikeALoadedFile();
    const glass = new FlatMaterial();
    const model = new Model3D({ source, materials: [undefined, glass] });

    expect(drawn(model)).toEqual([source.materials[0], glass, source.materials[2], source.materials[0]]);
  });

  it('calls a function once for each source material, so meshes that shared one share its replacement', () => {
    const source = createSourceLikeALoadedFile();
    const replace = vi.fn<(material: BaseMaterial3D) => BaseMaterial3D>((material) => material.clone());
    const model = new Model3D({ source, materials: replace });
    const [body, visorGlass, visorPaint, trim] = drawn(model);

    expect(replace).toHaveBeenCalledTimes(source.materials.length);
    expect(body).toBe(trim);
    expect(source.materials).not.toContain(body);
    expect([visorGlass, visorPaint].every((material) => !source.materials.includes(material))).toBe(true);
  });

  it('gives each model its own values when the function copies', () => {
    const source = createSourceLikeALoadedFile();
    const copy = (material: BaseMaterial3D) => material.clone();
    const a = new Model3D({ source, materials: copy });
    const b = new Model3D({ source, materials: copy });

    (a.materials[0] as Material3D).baseColor = 0x00ff00;

    expect((b.materials[0] as Material3D).baseColor).toBe(0x336699);
    expect((source.materials[0] as Material3D).baseColor).toBe(0x336699);
  });

  it("switches the meshes it built on assignment, back to the source's with undefined, destroying nothing", () => {
    const source = createSourceLikeALoadedFile();
    const model = new Model3D(source);
    const copies = source.materials.map((material) => material.clone());
    const destroyed = copies.map((material) => vi.spyOn(material, 'destroy'));

    model.materials = copies;
    expect(drawn(model)).toEqual([copies[0], copies[1], copies[2], copies[0]]);

    model.materials = undefined;
    expect(drawn(model)).toEqual([source.materials[0], source.materials[1], source.materials[2], source.materials[0]]);
    expect(model.materials).toBe(source.materials);
    expect(destroyed.some((spy) => spy.mock.calls.length > 0)).toBe(false);
  });

  it('leaves a mesh moved out of the model drawing what it drew', () => {
    const source = createSourceLikeALoadedFile();
    const model = new Model3D(source);
    const trim = meshesInBuildOrder(model)[3];
    const copies = source.materials.map((material) => material.clone());

    new Container3D().addChild(trim);
    model.materials = copies;

    expect(trim.material).toBe(source.materials[0]);
    expect(drawn(model)).toEqual([copies[0], copies[1], copies[2]]);
  });

  it('destroys the materials its meshes draw with material: true, and none of the source when they are copies', () => {
    const source = createSourceLikeALoadedFile();
    const model = new Model3D({ source, materials: (material) => material.clone() });
    const copies = [...model.materials];

    model.destroy({ children: true, material: true });

    expect(copies.slice(0, 3).every((material) => material.destroyed)).toBe(true);
    expect(source.materials.some((material) => material.destroyed)).toBe(false);
  });
});
