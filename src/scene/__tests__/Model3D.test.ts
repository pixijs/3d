import { describe, expect, it } from 'vitest';

import { Animation } from '~/animation/Animation';
import type { Scene3DDescriptor } from '~/assets/Scene3DDescriptor';
import { Scene3DSource } from '~/assets/Scene3DSource';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Box } from '~/math/shapes/Box';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';

/** A right triangle in the z = 0 plane, spanning 0 to 1 on x and y */
function createTriangleGeometry(): Geometry3D {
  return new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) });
}

function createIdentityMatrix4(): Float32Array {
  const matrix = new Float32Array(16);

  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;

  return matrix;
}

/** A source with one named mesh node in its only scene */
function createBoxSource(): Scene3DSource {
  const source = new Scene3DSource({
    scenes: [{ children: [0] }],
    nodes: [{ label: 'Box', children: [], geometry: 0, materials: [0] }],
  });

  source.geometries[0] = [createTriangleGeometry()];
  source.materials[0] = new Material3D({});

  return source;
}

describe('new Model3D', () => {
  it('merges defaultOptions under its options, skipping explicit undefineds, and forwards container options', () => {
    const model = new Model3D({
      source: createBoxSource(),
      castShadow: undefined,
      receiveShadow: false,
      label: 'robot',
    });
    const mesh = model.children[0] as Mesh3D;

    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    expect(model.label).toBe('robot');
  });

  it('builds no containers for joint nodes, leaving the skinned mesh beneath them as the only child', () => {
    const descriptor: Scene3DDescriptor = {
      scenes: [{ children: [25], name: 'Scene' }],
      nodes: [
        { label: 'LeftToeBase', children: [] },
        { label: 'LeftFoot', children: [] },
        { label: 'LeftLeg', children: [] },
        { label: 'LeftUpLeg', children: [] },
        { label: 'RightToeBase', children: [] },
        { label: 'RightFoot', children: [] },
        { label: 'RightLeg', children: [] },
        { label: 'RightUpLeg', children: [] },
        { label: 'LeftHand', children: [] },
        { label: 'LeftForeArm', children: [] },
        { label: 'LeftArm', children: [] },
        { label: 'LeftShoulder', children: [] },
        { label: 'RightHand', children: [] },
        { label: 'RightForeArm', children: [] },
        { label: 'RightArm', children: [] },
        { label: 'RightShoulder', children: [] },
        { label: 'head_end', children: [] },
        { label: 'headfront', children: [] },
        { label: 'Head', children: [] },
        { label: 'neck', children: [] },
        { label: 'Spine', children: [] },
        { label: 'Spine01', children: [] },
        { label: 'Spine02', children: [] },
        { label: 'Hips', children: [], isJoint: true },
        { label: 'char1', children: [], geometry: 0, materials: [0], skin: 0 },
        {
          label: 'Armature',
          children: [24, 23],
          isJoint: true,
          scale: new Float32Array([0.01, 0.01, 0.01]),
        },
      ],
      skins: [
        {
          inverseBindMatrices: createIdentityMatrix4(),
          skeletonParent: new Int16Array([-1, 0]),
          skeletonNodes: new Int32Array([25, 23]),
          skeletonJoints: new Int16Array([1]),
          skeletonLabels: ['Armature', 'Hips'],
          skeletonToModelRoot: true,
        },
      ],
    };

    const source = new Scene3DSource(descriptor);

    source.geometries[0] = [
      new Geometry3D({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      }),
    ];
    source.materials[0] = new Material3D({});

    const model = new Model3D(source);

    expect(model.children).toHaveLength(1);
    expect(model.children[0]).toBeInstanceOf(Mesh3D);
    expect(model.children[0].label).toBe('char1');
    expect(model.skeletons).toHaveLength(1);
  });

  it('binds a kept ancestor container to its bone, re-posing the skeleton whenever it moves', () => {
    /**
     * `Root` is the skeleton's root bone and has the skinned mesh beneath it, so it is not a joint
     * node and stays a Container3D
     */
    const descriptor: Scene3DDescriptor = {
      scenes: [{ children: [0], name: 'Scene' }],
      nodes: [
        { label: 'Root', children: [1, 2], scale: new Float32Array([2, 2, 2]) },
        { label: 'mesh', children: [], geometry: 0, materials: [0], skin: 0 },
        { label: 'Hips', children: [], isJoint: true },
      ],
      skins: [
        {
          inverseBindMatrices: createIdentityMatrix4(),
          skeletonParent: new Int16Array([-1, 0]),
          skeletonNodes: new Int32Array([0, 2]),
          skeletonJoints: new Int16Array([1]),
          skeletonLabels: ['Root', 'Hips'],
          skeletonToModelRoot: true,
        },
      ],
    };

    const source = new Scene3DSource(descriptor);

    source.geometries[0] = [createTriangleGeometry()];
    source.materials[0] = new Material3D({});

    const model = new Model3D(source);
    const skeleton = model.skeletons[0];

    const root = model.children.find((c) => c.label === 'Root');

    expect(root).toBeInstanceOf(Container3D);

    root!.position.set(7, 8, 9);
    skeleton.updateWorld();

    expect(skeleton.localPosition[0]).toBe(7);
    expect(skeleton.localPosition[1]).toBe(8);
    expect(skeleton.localPosition[2]).toBe(9);

    skeleton.updateWorld();
    expect(skeleton.dirty).toBe(false);

    root!.position.set(1, 2, 3);
    skeleton.updateWorld();

    expect(skeleton.localPosition[0], 'a container move after a clean update still re-poses the bone').toBe(1);
    expect(skeleton.localPosition[1]).toBe(2);
    expect(skeleton.localPosition[2]).toBe(3);
  });

  it('keeps the seeded bind pose of a bone that is also a detached skinned mesh', () => {
    /** A skin with no skeleton root whose skinned mesh node is itself the root bone, with the joint beneath it */
    const descriptor: Scene3DDescriptor = {
      scenes: [{ children: [0], name: 'Scene' }],
      nodes: [
        {
          label: 'meshRoot',
          children: [1],
          geometry: 0,
          materials: [0],
          skin: 0,
          position: new Float32Array([10, 0, 0]),
        },
        { label: 'Bone', children: [], isJoint: true },
      ],
      skins: [
        {
          inverseBindMatrices: createIdentityMatrix4(),
          skeletonParent: new Int16Array([-1, 0]),
          skeletonNodes: new Int32Array([0, 1]),
          skeletonJoints: new Int16Array([1]),
          skeletonLabels: ['meshRoot', 'Bone'],
          skeletonToModelRoot: true,
        },
      ],
    };

    const source = new Scene3DSource(descriptor);

    source.geometries[0] = [createTriangleGeometry()];
    source.materials[0] = new Material3D({});

    const model = new Model3D(source);
    const skeleton = model.skeletons[0];

    const mesh = model.children.find((c) => c instanceof Mesh3D) as Mesh3D;

    expect(mesh.position.x, 'the detached mesh drops its node transform').toBe(0);

    skeleton.updateWorld();

    expect(skeleton.localPosition[0]).toBe(10);
  });

  it('detaches a multi-primitive skinned mesh as a Container3D of primitive meshes sharing one skeleton', () => {
    const descriptor: Scene3DDescriptor = {
      scenes: [{ children: [0], name: 'Scene' }],
      nodes: [
        { label: 'mesh', children: [1], geometry: 0, materials: [0, 0], skin: 0 },
        { label: 'Bone', children: [], isJoint: true },
      ],
      skins: [
        {
          inverseBindMatrices: createIdentityMatrix4(),
          skeletonParent: new Int16Array([-1]),
          skeletonNodes: new Int32Array([1]),
          skeletonJoints: new Int16Array([0]),
          skeletonLabels: ['Bone'],
          skeletonToModelRoot: true,
        },
      ],
    };

    const source = new Scene3DSource(descriptor);

    source.geometries[0] = [createTriangleGeometry(), createTriangleGeometry()];
    source.materials[0] = new Material3D({});

    const model = new Model3D(source);

    expect(model.children).toHaveLength(1);

    const wrapper = model.children[0];

    expect(wrapper).toBeInstanceOf(Container3D);
    expect(wrapper).not.toBeInstanceOf(Mesh3D);
    expect(wrapper.children).toHaveLength(2);

    for (const child of wrapper.children) {
      expect(child).toBeInstanceOf(Mesh3D);
      expect((child as Mesh3D).skeleton).toBe(model.skeletons[0]);
    }
  });

  it('passes autoPlay through to created animation players', () => {
    const source = new Scene3DSource({});

    source.animations.idle = new Animation({ label: 'idle', duration: 1 });
    source.animations.walk = new Animation({ label: 'walk', duration: 1 });

    const idle = new Model3D({ source, autoUpdate: false });
    const first = new Model3D({ source, autoUpdate: false, autoPlay: true });
    const walk = new Model3D({ source, autoUpdate: false, autoPlay: 'walk' });

    expect(idle.player!.playing).toBe(false);
    expect(first.player!.getState('idle').playing).toBe(true);
    expect(walk.player!.getState('walk').playing).toBe(true);
    expect(walk.player!.getState('idle').playing).toBe(false);
  });

  it('sizes width and height against the built graph', () => {
    const model = new Model3D({ source: createBoxSource(), width: 2, height: 4 });

    expect(model.scale.x, 'sizing before the build would measure empty bounds and leave the scale at 1').toBe(2);
    expect(model.scale.y).toBe(4);
    expect(model.width).toBeCloseTo(2);
    expect(model.height).toBeCloseTo(4);
  });

  it("resolves a 'box' hitVolume against the built graph, not the zero box an unbuilt model would snapshot", () => {
    const model = new Model3D({ source: createBoxSource(), hitVolume: 'box' });
    const box = model._hitVolumeResolved as Box;

    expect([box.min.x, box.min.y, box.min.z]).toEqual([0, 0, 0]);
    expect([box.max.x, box.max.y, box.max.z]).toEqual([1, 1, 0]);
  });

  it('adds itself to parent once the graph and player are built', () => {
    const source = createBoxSource();

    source.animations.idle = new Animation({ label: 'idle', duration: 1 });

    const parent = new Container3D();
    let seen: { children: number; hasPlayer: boolean } | undefined;

    parent.on('childAdded', (child) => {
      const added = child as Model3D;

      seen = { children: added.children.length, hasPlayer: added.player !== undefined };
    });

    const model = new Model3D({ source, parent, autoUpdate: false });

    expect(model.parent).toBe(parent);
    expect(seen).toEqual({ children: 1, hasPlayer: true });
  });
});

describe('Model3D cameras', () => {
  /** A source whose only scene holds one camera node, placed at z = 5 */
  function createCameraSource(far?: number): Scene3DSource {
    return new Scene3DSource({
      scenes: [{ children: [0] }],
      nodes: [{ label: 'Rig', children: [], camera: 0, position: new Float32Array([0, 0, 5]) }],
      cameras: [{ fov: Math.PI / 2, near: 0.5, far, mode: 0 }],
    });
  }

  it('instantiates a camera node as a Camera3D in degrees, at its node transform', () => {
    const model = new Model3D(createCameraSource(50));
    const camera = model.children[0] as Camera3D;

    expect(camera).toBeInstanceOf(Camera3D);
    expect(camera.label).toBe('Rig');
    expect(camera.fov).toBeCloseTo(90);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(50);
    expect(camera.position.z).toBe(5);
    expect(model.cameras).toEqual([camera]);
  });

  it('falls back to the default far plane when the file leaves it out', () => {
    const model = new Model3D(createCameraSource());

    expect(model.cameras[0].far).toBe(Camera3D.defaultOptions.far);
  });

  it('releases its camera index on destroy', () => {
    const model = new Model3D(createCameraSource(50));
    const camera = model.cameras[0];

    model.destroy({ children: true });

    expect(model.cameras).toHaveLength(0);
    expect(camera.destroyed).toBe(true);
  });
});
