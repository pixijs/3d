import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Material3D } from '~/materials/pbr/Material3D';

/** Builds a material owning one non-shared baseColor texture + its source. */
function materialWithTexture(): { material: Material3D; texture: Texture; source: TextureSource } {
  const source = new TextureSource({ width: 4, height: 4 });
  const texture = new Texture({ source });
  const material = new Material3D({ baseColorTexture: texture });
  return { material, texture, source };
}

describe('BaseMaterial3D.destroy texture flags', () => {
  it('destroy({ textureSource: true }) alone frees nothing — `texture` is the gate, as in 2D', () => {
    const { material, texture, source } = materialWithTexture();

    material.destroy({ textureSource: true });

    expect(texture.destroyed).toBe(false);
    expect(source.destroyed).toBe(false);

    texture.destroy(true);
    expect(source.destroyed).toBe(true);
  });

  it('destroy({ texture: true, textureSource: true }) frees the texture and its source', () => {
    const { material, texture, source } = materialWithTexture();

    material.destroy({ texture: true, textureSource: true });

    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
  });

  it('destroy({ texture: true }) frees the texture but keeps its source', () => {
    const { material, texture, source } = materialWithTexture();

    material.destroy({ texture: true });

    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(false);

    source.destroy();
  });

  it('a flagless destroy keeps the texture (shared by default)', () => {
    const { material, texture, source } = materialWithTexture();

    material.destroy();

    expect(texture.destroyed).toBe(false);

    texture.destroy(true);
    expect(source.destroyed).toBe(true);
  });
});
