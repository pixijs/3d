/**
 * Manifest of every remote asset the repo uses — the single source of truth
 * for the local mirror. `scripts/assets/download-assets.mts` mirrors each
 * asset into a store shared by every clone and worktree (`~/.pixijs/mirror`
 * by default, cached in CI) that the gitignored `examples/assets/mirror`
 * symlink points at, and every environment serves that directory at
 * `/mirror/` (vitest via its publicDir,
 * the playground via a static route), so the accessors below resolve
 * identically in tests, examples, and the playground.
 *
 * A category record maps asset names to remote URLs, optionally nested one
 * level into groups; the group is the mirror folder, so `gltf.Box` lives at
 * `/mirror/gltf/Box.glb` while an ungrouped entry sits directly under
 * `/mirror/`. The file is named after the entry, and multi-file assets (a
 * `.gltf` plus its sidecar buffers/textures) get a per-asset folder —
 * `/mirror/gltf/ABeautifulGame/ABeautifulGame.gltf` — so generically-named
 * sidecars never collide. A name may contain `/` to put the file in a
 * subfolder of its group, for a file that another asset finds by relative
 * path: the racing kit's `.glb`s read `Textures/colormap.png` beside them, so
 * `racing.Textures/colormap` is served at `/mirror/racing/Textures/colormap.png`.
 *
 * To use a new asset, add its URL to the matching category record and
 * reference it by dotted name (e.g. `model('gltf.Box')`). New categories
 * (textures, cubemaps, …) are further `as const` records alongside `models`,
 * each with its own typed accessor.
 */

/** Route the local mirror is served under in every environment. */
export const MIRROR_ROUTE = '/mirror/';

/** A manifest category: remote URLs keyed by asset name, optionally grouped one level deep. */
export interface AssetCategory {
  readonly [key: string]: string | { readonly [name: string]: string };
}

/** Dotted names of a category's entries: `Name` for top-level entries, `group.Name` for grouped ones. */
type AssetName<C extends AssetCategory> = {
  [K in keyof C & string]: C[K] extends string ? K : `${K}.${keyof C[K] & string}`;
}[keyof C & string];

/** A category entry flattened for mirroring: remote URL and served path. */
export interface AssetEntry {
  url: string;
  path: string;
}

/**
 * Served path of one entry: `/mirror/<group>/<Name>.<ext>` with the extension
 * taken from the URL, and a per-asset folder for multi-file `.gltf` assets.
 */
function servedPath(group: string | undefined, name: string, url: string): string {
  const extension = url.slice(url.lastIndexOf('.') + 1);
  const dir = group === undefined ? MIRROR_ROUTE : `${MIRROR_ROUTE}${group}/`;

  return extension === 'gltf' ? `${dir}${name}/${name}.gltf` : `${dir}${name}.${extension}`;
}

/** Flattens a category to its mirrored entries; the download script's view of the manifest. */
export function assetEntries(category: AssetCategory): AssetEntry[] {
  const entries: AssetEntry[] = [];
  for (const [key, value] of Object.entries(category)) {
    if (typeof value === 'string') {
      entries.push({ url: value, path: servedPath(undefined, key, value) });
    } else {
      for (const [name, url] of Object.entries(value)) {
        entries.push({ url, path: servedPath(key, name, url) });
      }
    }
  }

  return entries;
}

/** Resolves a dotted asset name against a category to its served mirror path. */
function assetUrl(category: AssetCategory, name: string): string {
  const dot = name.indexOf('.');
  const group = dot === -1 ? undefined : name.slice(0, dot);
  const key = dot === -1 ? name : name.slice(dot + 1);
  const scope = group === undefined ? category : category[group];
  const url = typeof scope === 'object' ? scope[key] : undefined;
  if (typeof url !== 'string') {
    throw new Error(`Unknown asset: ${name}`);
  }

  return servedPath(group, key, url);
}

/** PixiJS's own asset store, pinned to one commit so a mirrored file never changes under the same path. */
const PIXI_STORAGE =
  'https://raw.githubusercontent.com/pixijs/pixi-asset-storage/e73783699c4953aee0453b5ca12506f6fa515f8d';

/** Kenney's Starter Kit Racing (CC0) in the asset store; its skid sound is by Landeplage. */
const RACING_KIT = `${PIXI_STORAGE}/kenney/starter-kit-racing`;

/**
 * glTF/GLB models, served from `/mirror/<group>/`: Khronos and gltf-test
 * samples in `gltf`, PixiJS's own in `pixijs`, and the racing demo's kit in
 * `racing`, which keeps the kit's file names.
 */
export const models = {
  gltf: {
    '2CylinderEngine':
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/2CylinderEngine/glTF-Binary/2CylinderEngine.glb',
    ABeautifulGame:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ABeautifulGame/glTF/ABeautifulGame.gltf',
    AdvancedMaterial:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/AdvancedMaterial/glTF/AdvancedMaterial.gltf',
    AlphaBlendModeTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/AlphaBlendModeTest/glTF-Binary/AlphaBlendModeTest.glb',
    AnimateAllTheThings:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/AnimateAllTheThings/glTF-Binary/AnimateAllTheThings.glb',
    AnimatedColorsCube:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnimatedColorsCube/glTF-Binary/AnimatedColorsCube.glb',
    AnimatedCube:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/AnimatedCube/glTF/AnimatedCube.gltf',
    AnimatedMorphCube:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/AnimatedMorphCube/glTF-Binary/AnimatedMorphCube.glb',
    AnimatedMorphSphere:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/AnimatedMorphSphere/glTF-Binary/AnimatedMorphSphere.glb',
    AnimatedTriangle:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/AnimatedTriangle/glTF/AnimatedTriangle.gltf',
    AnimatedWaterfall:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/AnimatedWaterfall/glTF-Binary/AnimatedWaterfall.glb',
    AnimationPointerUVs:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnimationPointerUVs/glTF-Binary/AnimationPointerUVs.glb',
    AnisotropyBarnLamp:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnisotropyBarnLamp/glTF-Binary/AnisotropyBarnLamp.glb',
    AnisotropyBarnLampKtx2:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnisotropyBarnLamp/glTF-KTX-BasisU/AnisotropyBarnLamp.gltf',
    AnisotropyDiscTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnisotropyDiscTest/glTF-Binary/AnisotropyDiscTest.glb',
    AnisotropyRotationTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnisotropyRotationTest/glTF-Binary/AnisotropyRotationTest.glb',
    AnisotropyStrengthTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnisotropyStrengthTest/glTF-Binary/AnisotropyStrengthTest.glb',
    AntiqueCamera:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/AntiqueCamera/glTF-Binary/AntiqueCamera.glb',
    AttenuationTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/AttenuationTest/glTF-Binary/AttenuationTest.glb',
    Avocado:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Avocado/glTF-Binary/Avocado.glb',
    BarramundiFish:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BarramundiFish/glTF-Binary/BarramundiFish.glb',
    BoomBox:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoomBox/glTF-Binary/BoomBox.glb',
    BoomBoxWithAxes:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoomBoxWithAxes/glTF/BoomBoxWithAxes.gltf',
    Box: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Box/glTF-Binary/Box.glb',
    BoxAnimated:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxAnimated/glTF-Binary/BoxAnimated.glb',
    BoxInterleaved:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxInterleaved/glTF-Binary/BoxInterleaved.glb',
    BoxTextured:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxTextured/glTF-Binary/BoxTextured.glb',
    BoxTexturedNonPowerOfTwo:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxTexturedNonPowerOfTwo/glTF-Binary/BoxTexturedNonPowerOfTwo.glb',
    BoxVertexColors:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxVertexColors/glTF-Binary/BoxVertexColors.glb',
    BoxWithSpaces:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Box%20With%20Spaces/glTF/Box%20With%20Spaces.gltf',
    BrainStem:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BrainStem/glTF-Binary/BrainStem.glb',
    BrainStemMeshopt:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/BrainStem/glTF-Meshopt/BrainStem.gltf',
    Buggy: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Buggy/glTF-Binary/Buggy.glb',
    Cameras: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Cameras/glTF/Cameras.gltf',
    CarbonFibre:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/CarbonFibre/glTF-Binary/CarbonFibre.glb',
    CarbonFrameBike:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/CarbonFrameBike/glTF-Binary/CarbonFrameBike.glb',
    CarConcept:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb',
    CesiumMan:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/CesiumMan/glTF-Binary/CesiumMan.glb',
    CesiumManDraco:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Draco/CesiumMan.gltf',
    CesiumMilkTruck:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb',
    ChairDamaskPurplegold:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ChairDamaskPurplegold/glTF-Binary/ChairDamaskPurplegold.glb',
    ChronographWatch:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ChronographWatch/glTF-Binary/ChronographWatch.glb',
    ChronographWatchKtx2:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ChronographWatch/glTF-KTX-BasisU/ChronographWatch.gltf',
    ClearCoatCarPaint:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ClearCoatCarPaint/glTF-Binary/ClearCoatCarPaint.glb',
    ClearcoatRing:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ClearcoatRing/glTF/ClearcoatRing.gltf',
    ClearcoatSphere:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ClearcoatSphere/glTF/ClearcoatSphere.gltf',
    ClearCoatTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ClearCoatTest/glTF-Binary/ClearCoatTest.glb',
    ClearcoatWicker:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ClearcoatWicker/glTF-Binary/ClearcoatWicker.glb',
    CommercialRefrigerator:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CommercialRefrigerator/glTF-Binary/CommercialRefrigerator.glb',
    CompareAlphaCoverage:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareAlphaCoverage/glTF-Binary/CompareAlphaCoverage.glb',
    CompareAmbientOcclusion:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareAmbientOcclusion/glTF-Binary/CompareAmbientOcclusion.glb',
    CompareAnisotropy:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareAnisotropy/glTF-Binary/CompareAnisotropy.glb',
    CompareBaseColor:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareBaseColor/glTF-Binary/CompareBaseColor.glb',
    CompareClearcoat:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareClearcoat/glTF-Binary/CompareClearcoat.glb',
    CompareDispersion:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareDispersion/glTF-Binary/CompareDispersion.glb',
    CompareEmissiveStrength:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareEmissiveStrength/glTF-Binary/CompareEmissiveStrength.glb',
    CompareIor:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareIor/glTF-Binary/CompareIor.glb',
    CompareIridescence:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareIridescence/glTF-Binary/CompareIridescence.glb',
    CompareMetallic:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareMetallic/glTF-Binary/CompareMetallic.glb',
    CompareNormal:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareNormal/glTF-Binary/CompareNormal.glb',
    CompareRoughness:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareRoughness/glTF-Binary/CompareRoughness.glb',
    CompareSheen:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareSheen/glTF-Binary/CompareSheen.glb',
    CompareSpecular:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareSpecular/glTF-Binary/CompareSpecular.glb',
    CompareTransmission:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareTransmission/glTF-Binary/CompareTransmission.glb',
    CompareVolume:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CompareVolume/glTF-Binary/CompareVolume.glb',
    Corset: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Corset/glTF-Binary/Corset.glb',
    Cube: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Cube/glTF/Cube.gltf',
    DamagedHelmet:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
    DiffuseTransmissionPlant:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DiffuseTransmissionPlant/glTF-Binary/DiffuseTransmissionPlant.glb',
    DiffuseTransmissionTeacup:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DiffuseTransmissionTeacup/glTF-Binary/DiffuseTransmissionTeacup.glb',
    DiffuseTransmissionTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DiffuseTransmissionTest/glTF-Binary/DiffuseTransmissionTest.glb',
    DirectionalLight:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DirectionalLight/glTF-Binary/DirectionalLight.glb',
    DispersionTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DispersionTest/glTF-Binary/DispersionTest.glb',
    DragonAttenuation:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DragonAttenuation/glTF-Binary/DragonAttenuation.glb',
    DragonAttenuationMaterialAnimation:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/DragonAttenuation-MaterialAnimation/glTF-Binary/DragonAttenuation-MaterialAnimation.glb',
    DragonDispersion:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DragonDispersion/glTF-Binary/DragonDispersion.glb',
    Duck: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Duck/glTF-Binary/Duck.glb',
    DuckQuantized:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Quantized/Duck.gltf',
    EmissiveFireflies:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/EmissiveFireflies/glTF-Binary/EmissiveFireflies.glb',
    EmissiveStrengthTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/EmissiveStrengthTest/glTF-Binary/EmissiveStrengthTest.glb',
    EnvironmentTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/EnvironmentTest/glTF/EnvironmentTest.gltf',
    FlightHelmet:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/FlightHelmet/glTF/FlightHelmet.gltf',
    Fox: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Fox/glTF-Binary/Fox.glb',
    GearboxAssy:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/GearboxAssy/glTF-Binary/GearboxAssy.glb',
    GlamVelvetSofa:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb',
    GlassBrokenWindow:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/GlassBrokenWindow/glTF-Binary/GlassBrokenWindow.glb',
    GlassHurricaneCandleHolder:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/GlassHurricaneCandleHolder/glTF-Binary/GlassHurricaneCandleHolder.glb',
    GlassVaseFlowers:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/GlassVaseFlowers/glTF-Binary/GlassVaseFlowers.glb',
    InterpolationTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/InterpolationTest/glTF-Binary/InterpolationTest.glb',
    IORTestGrid:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/IORTestGrid/glTF-Binary/IORTestGrid.glb',
    IridescenceAbalone:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/IridescenceAbalone/glTF-Binary/IridescenceAbalone.glb',
    IridescenceDielectricSpheres:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/IridescenceDielectricSpheres/glTF/IridescenceDielectricSpheres.gltf',
    IridescenceLamp:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/IridescenceLamp/glTF-Binary/IridescenceLamp.glb',
    IridescenceMetallicSpheres:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf',
    IridescenceSuzanne:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/IridescenceSuzanne/glTF-Binary/IridescenceSuzanne.glb',
    IridescentDishWithOlives:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/IridescentDishWithOlives/glTF-Binary/IridescentDishWithOlives.glb',
    Knight: 'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/Knight/glTF-Binary/Knight.glb',
    Lantern:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Lantern/glTF-Binary/Lantern.glb',
    Lights: 'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/Lights/glTF-Binary/Lights.glb',
    LightsPunctualLamp:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/LightsPunctualLamp/glTF-Binary/LightsPunctualLamp.glb',
    MandarinOrange:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/MandarinOrange/glTF/MandarinOrange.gltf',
    MarblesForever:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/MarblesForever/glTF-Binary/MarblesForever.glb',
    MaterialsVariantsChair:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/MaterialsVariantsChair/glTF-Binary/MaterialsVariantsChair.glb',
    MaterialsVariantsShoe:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb',
    MeshPrimitiveModes:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MeshPrimitiveModes/glTF/MeshPrimitiveModes.gltf',
    MetalRoughSpheres:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MetalRoughSpheres/glTF-Binary/MetalRoughSpheres.glb',
    MetalRoughSpheresNoTextures:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MetalRoughSpheresNoTextures/glTF-Binary/MetalRoughSpheresNoTextures.glb',
    MorphPrimitivesTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MorphPrimitivesTest/glTF-Binary/MorphPrimitivesTest.glb',
    MorphStressTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MorphStressTest/glTF-Binary/MorphStressTest.glb',
    MosquitoInAmber:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MosquitoInAmber/glTF-Binary/MosquitoInAmber.glb',
    MultipleScenes:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MultipleScenes/glTF/MultipleScenes.gltf',
    MultiUVTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MultiUVTest/glTF-Binary/MultiUVTest.glb',
    NegativeScaleTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/NegativeScaleTest/glTF-Binary/NegativeScaleTest.glb',
    NodePerformanceTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/NodePerformanceTest/glTF-Binary/NodePerformanceTest.glb',
    NormalTangentMirrorTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/NormalTangentMirrorTest/glTF-Binary/NormalTangentMirrorTest.glb',
    NormalTangentTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/NormalTangentTest/glTF-Binary/NormalTangentTest.glb',
    OrientationTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/OrientationTest/glTF-Binary/OrientationTest.glb',
    PlaysetLightTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/PlaysetLightTest/glTF-Binary/PlaysetLightTest.glb',
    PointLightIntensityTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/PointLightIntensityTest/glTF-Binary/PointLightIntensityTest.glb',
    PointsLinesTrianglesTest:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/PointsLinesTrianglesTest/glTF/PointsLinesTrianglesTest.gltf',
    PotOfCoals:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/PotOfCoals/glTF-Binary/PotOfCoals.glb',
    PotOfCoalsAnimationPointer:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/PotOfCoalsAnimationPointer/glTF-Binary/PotOfCoalsAnimationPointer.glb',
    PrimitiveModeNormalsTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/PrimitiveModeNormalsTest/glTF/PrimitiveModeNormalsTest.gltf',
    ReciprocatingSaw:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ReciprocatingSaw/glTF-Binary/ReciprocatingSaw.glb',
    RecursiveSkeletons:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/RecursiveSkeletons/glTF-Binary/RecursiveSkeletons.glb',
    RiggedFigure:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/RiggedFigure/glTF-Binary/RiggedFigure.glb',
    RiggedSimple:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/RiggedSimple/glTF-Binary/RiggedSimple.glb',
    SciFiHelmet:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SciFiHelmet/glTF/SciFiHelmet.gltf',
    ShaderBall: 'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/ShaderBall.glb',
    SheenChair:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SheenChair/glTF-Binary/SheenChair.glb',
    SheenCloth:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SheenCloth/glTF/SheenCloth.gltf',
    SheenDamask:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SheenDamask/glTF/SheenDamask.gltf',
    SheenHighHeel:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SheenHighHeel/glTF/SheenHighHeel.gltf',
    SheenTestGrid:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SheenTestGrid/glTF-Binary/SheenTestGrid.glb',
    SheenWoodLeatherSofa:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SheenWoodLeatherSofa/glTF-Binary/SheenWoodLeatherSofa.glb',
    SimpleInstancing:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SimpleInstancing/glTF-Binary/SimpleInstancing.glb',
    SimpleMaterial:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SimpleMaterial/glTF/SimpleMaterial.gltf',
    SimpleMeshes:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SimpleMeshes/glTF/SimpleMeshes.gltf',
    SimpleMorph:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SimpleMorph/glTF/SimpleMorph.gltf',
    SimpleOpacity:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/SimpleOpacity/glTF/SimpleOpacity.gltf',
    SimpleSkin:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SimpleSkin/glTF/SimpleSkin.gltf',
    SimpleSparseAccessor:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SimpleSparseAccessor/glTF/SimpleSparseAccessor.gltf',
    SimpleTexture:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SimpleTexture/glTF/SimpleTexture.gltf',
    SpecGlossVsMetalRough:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SpecGlossVsMetalRough/glTF-Binary/SpecGlossVsMetalRough.glb',
    SpecularSilkPouf:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SpecularSilkPouf/glTF-Binary/SpecularSilkPouf.glb',
    SpecularTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SpecularTest/glTF-Binary/SpecularTest.glb',
    Sponza: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Sponza/glTF/Sponza.gltf',
    StainedGlassLamp:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/StainedGlassLamp/glTF/StainedGlassLamp.gltf',
    SunglassesKhronos:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SunglassesKhronos/glTF-Binary/SunglassesKhronos.glb',
    SunglassesKhronosDraco:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SunglassesKhronos/glTF-Draco/SunglassesKhronos.gltf',
    Suzanne: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Suzanne/glTF/Suzanne.gltf',
    SuzanneMorphSparse:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SuzanneMorphSparse/glTF-Binary/SuzanneMorphSparse.glb',
    TeapotsGalore:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/TeapotsGalore/glTF/TeapotsGalore.gltf',
    TextureCoordinateTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TextureCoordinateTest/glTF-Binary/TextureCoordinateTest.glb',
    TextureEncodingTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TextureEncodingTest/glTF-Binary/TextureEncodingTest.glb',
    TextureLinearInterpolationTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TextureLinearInterpolationTest/glTF-Binary/TextureLinearInterpolationTest.glb',
    TextureSettingsTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TextureSettingsTest/glTF-Binary/TextureSettingsTest.glb',
    TextureTransformMultiTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TextureTransformMultiTest/glTF-Binary/TextureTransformMultiTest.glb',
    TextureTransformTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TextureTransformTest/glTF/TextureTransformTest.gltf',
    ToyCar: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/ToyCar/glTF-Binary/ToyCar.glb',
    ToyCarSpecular:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/ToyCarSpecular/glTF/ToyCarSpecular.gltf',
    TransmissionOrderTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/TransmissionOrderTest/glTF-Binary/TransmissionOrderTest.glb',
    TransmissionRoughnessTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TransmissionRoughnessTest/glTF-Binary/TransmissionRoughnessTest.glb',
    TransmissionSphere:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/TransmissionSphere/glTF-Binary/TransmissionSphere.glb',
    TransmissionSuzanne:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TransmissionSuzanne/glTF/TransmissionSuzanne.gltf',
    TransmissionTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TransmissionTest/glTF-Binary/TransmissionTest.glb',
    TransmissionThinwallTestGrid:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/TransmissionThinwallTestGrid/glTF-Binary/TransmissionThinwallTestGrid.glb',
    Triangle: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Triangle/glTF/Triangle.gltf',
    TriangleWithoutIndices:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TriangleWithoutIndices/glTF/TriangleWithoutIndices.gltf',
    TwoSidedPlane:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/TwoSidedPlane/glTF/TwoSidedPlane.gltf',
    UnicodeTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Unicode%E2%9D%A4%E2%99%BBTest/glTF-Binary/Unicode%E2%9D%A4%E2%99%BBTest.glb',
    UnlitTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/UnlitTest/glTF-Binary/UnlitTest.glb',
    VC: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/VC/glTF-Binary/VC.glb',
    VertexColorAlphaClipTest:
      'https://raw.githubusercontent.com/cx20/gltf-test/master/tutorialModels/VertexColorAlphaClipTest/glTF-Binary/VertexColorAlphaClipTest.glb',
    VertexColorTest:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/VertexColorTest/glTF-Binary/VertexColorTest.glb',
    VirtualCity:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/VirtualCity/glTF-Binary/VirtualCity.glb',
    WaterBottle:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/WaterBottle/glTF-Binary/WaterBottle.glb',
    WaterBottleDraco:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/WaterBottle/glTF-Draco/WaterBottle.gltf',
    XmpMetadataRoundedCube:
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/XmpMetadataRoundedCube/glTF-Binary/xmp.glb',
  },
  pixijs: {
    Diorama: `${PIXI_STORAGE}/pixijs/diorama.gltf`,
    Logo: `${PIXI_STORAGE}/pixijs/pixijs-logo.glb`,
  },
  racing: {
    'decoration-empty': `${RACING_KIT}/decoration-empty.glb`,
    'decoration-forest': `${RACING_KIT}/decoration-forest.glb`,
    'decoration-tents': `${RACING_KIT}/decoration-tents.glb`,
    'track-bump': `${RACING_KIT}/track-bump.glb`,
    'track-corner': `${RACING_KIT}/track-corner.glb`,
    'track-finish': `${RACING_KIT}/track-finish.glb`,
    'track-straight': `${RACING_KIT}/track-straight.glb`,
    'vehicle-truck-green': `${RACING_KIT}/vehicle-truck-green.glb`,
    'vehicle-truck-purple': `${RACING_KIT}/vehicle-truck-purple.glb`,
    'vehicle-truck-red': `${RACING_KIT}/vehicle-truck-red.glb`,
    'vehicle-truck-yellow': `${RACING_KIT}/vehicle-truck-yellow.glb`,
  },
} as const;

type ModelName = AssetName<typeof models>;

/** Local mirror URL for a model, as served at `/mirror/` in every environment. */
export function model(name: ModelName): string {
  return assetUrl(models, name);
}

/** HDR panoramas from Poly Haven (CC0); the `hdri` group is served from `/mirror/hdri/`. */
export const environments = {
  hdri: {
    VeniceSunset: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr',
  },
} as const;

type EnvironmentName = AssetName<typeof environments>;

/** Local mirror URL for an HDR panorama, as served at `/mirror/` in every environment. */
export function environment(name: EnvironmentName): string {
  return assetUrl(environments, name);
}

/**
 * Images, served from `/mirror/<group>/`: pixi's own example images in
 * `pixijs`, and the racing kit's smoke sprite and the colormap its models read.
 */
export const textures = {
  pixijs: {
    Bunny: 'https://pixijs.com/assets/bunny.png',
    SceneRotate: 'https://pixijs.com/assets/bg_scene_rotate.jpg',
  },
  racing: {
    smoke: `${RACING_KIT}/sprites/smoke.png`,
    'Textures/colormap': `${RACING_KIT}/Textures/colormap.png`,
  },
} as const;

type TextureName = AssetName<typeof textures>;

/** Local mirror URL for an image, as served at `/mirror/` in every environment. */
export function texture(name: TextureName): string {
  return assetUrl(textures, name);
}

/** Sounds, served from `/mirror/<group>/`: the racing kit's engine, impact and skid loops. */
export const sounds = {
  racing: {
    engine: `${RACING_KIT}/audio/engine.ogg`,
    impact: `${RACING_KIT}/audio/impact.ogg`,
    skid: `${RACING_KIT}/audio/skid.ogg`,
  },
} as const;

type SoundName = AssetName<typeof sounds>;

/** Local mirror URL for a sound, as served at `/mirror/` in every environment. */
export function sound(name: SoundName): string {
  return assetUrl(sounds, name);
}

/** Videos made for PixiJS's examples; the `pixijs` group is served from `/mirror/pixijs/`. */
export const videos = {
  pixijs: {
    SharedVideoMotion: `${PIXI_STORAGE}/pixijs/shared_video_motion.mp4`,
  },
} as const;

type VideoName = AssetName<typeof videos>;

/** Local mirror URL for a video, as served at `/mirror/` in every environment. */
export function video(name: VideoName): string {
  return assetUrl(videos, name);
}
