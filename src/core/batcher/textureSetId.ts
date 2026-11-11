const textureSetIdsByHash = new Map<number, number>();
let nextTextureSetId = 0;

/**
 * The id every material with these sources in these slots shares, counted from 0 so the sort key's 16-bit
 * field keeps the first 65,536 sets apart; never freed, like pixi's `uid()`
 *
 * Looked up by a 53-bit hash of the source uids in slot order; two sets on one hash would draw as one.
 * @internal
 */
export function textureSetId(textures: ArrayLike<{ source: { uid: number } }>): number {
  let lo = 0x811c9dc5;
  let hi = 0x9e3779b9;

  for (let t = 0; t < textures.length; t++) {
    const uid = textures[t].source.uid;
    lo = Math.imul(lo ^ uid, 0x01000193);
    hi = Math.imul(hi + uid, 0x85ebca6b);
    hi ^= hi >>> 13;
  }

  const hash = (hi >>> 11) * 0x1_0000_0000 + (lo >>> 0);
  let id = textureSetIdsByHash.get(hash);

  if (id === undefined) {
    id = nextTextureSetId++;
    textureSetIdsByHash.set(hash, id);
  }

  return id;
}
