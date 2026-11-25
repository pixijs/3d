import { getApp, renderFrame } from '@test-utils';
import { State } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { passBitRegistry } from '~/core/render-passes/passBitRegistry';
import { instanceFetchBitGl } from '~/core/shader/bits/instanceFetchBitGl';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DData } from '~/materials/pbr/Material3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { engineTemplateCopy } from '../../../../tests/scenes/helpers/engineTemplateCopy';

const SIZE = 128;

const greenBit: ShaderBit = {
  name: 'passLevelGreen',
  gpu: { fragment: { end: 'finalColor = vec3<f32>(0.0, 1.0, 0.0); alpha = 1.0;' } },
  gl: { fragment: { end: 'finalColor = vec3(0.0, 1.0, 0.0); alpha = 1.0;' } },
};

const shiftBit: ShaderBit = {
  name: 'passLevelShift',
  level: 'shape',
  gpu: { vertex: { beforeTransform: 'position.x += 4.0;' } },
  gl: { vertex: { beforeTransform: 'position.x += 4.0;' } },
};

const materialShiftBit: ShaderBit = {
  name: 'passLevelMaterialShift',
  level: 'shape',
  bindings: { material: { uShift: 'f32' } },
  gpu: { vertex: { beforeTransform: 'position.x += material.uShift;' } },
  gl: { vertex: { beforeTransform: 'position.x += material.uShift;' } },
};

const passShiftBit: ShaderBit = {
  name: 'passLevelPassShift',
  bindings: { material: { uPassShift: 'f32' } },
  gpu: { vertex: { beforeTransform: 'position.x += material.uPassShift;' } },
  gl: { vertex: { beforeTransform: 'position.x += material.uPassShift;' } },
};

const droppedShiftBit: ShaderBit = {
  name: 'passLevelDroppedShift',
  bindings: { material: { uShift: 'f32' } },
  gpu: { vertex: { beforeTransform: 'position.x += material.uShift;' } },
  gl: { vertex: { beforeTransform: 'position.x += material.uShift;' } },
};

const requiringBit: ShaderBit = {
  name: 'passLevelRequiring',
  level: 'shape',
  requires: [droppedShiftBit],
};

const wholeGreenTemplate: ShaderBitTemplate = {
  bindGroups: [{ name: 'global', ubo: true }, 'camera'],
  gpu: `
{{header}}
{{vertexHeader}}

@vertex
fn mainVertex(
  input: VertexInput,
  @builtin(instance_index) ii: u32,
  @builtin(vertex_index) vid: u32
) -> VertexOutput {
  var output: VertexOutput;

  var position: vec4<f32>;
  var normal = input.aNormal;
  var tangent = vec3<f32>(0.0);

  let renderable = uRenderableStorage[uRenderableInstanceStorage[ii].id];
  let batchWorldMatrix = uRenderableStorage[0].transform;
  var modelMatrix = batchWorldMatrix * renderable.transform;

  {{vertexInput}}

  let worldPosition = modelMatrix * position;
  output.position = camera.uViewProjectionMatrix * worldPosition;

  {{vertexEnd}}

  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 1.0, 0.0, 1.0);
}
`,
  gl: {
    vertex: `#version 300 es

{{header}}

void main() {
  mat4 modelMatrix;
  vec4 position;
  vec3 normal = aNormal;
  vec3 tangent = vec3(0.0);

  {{input}}

  vec4 worldPosition = modelMatrix * position;
  gl_Position = uViewProjectionMatrix * worldPosition;

  {{end}}
}`,
    fragment: `#version 300 es
out vec4 fragColor;

{{header}}

void main() {
  fragColor = vec4(0.0, 1.0, 0.0, 1.0);
}`,
  },
};

const wholeGreenBit: ShaderBit = {
  name: 'passLevelWholeGreen',
  attributes: { aNormal: 'float32x3' },
};

const gainTemplate = engineTemplateCopy('let templateGain = 0.5;', 'float templateGain = 0.5;');

const templateGainBit: ShaderBit = {
  name: 'passLevelTemplateGain',
  gpu: { fragment: { end: 'finalColor = vec3<f32>(0.0, 2.0 * templateGain, 0.0); alpha = 1.0;' } },
  gl: { fragment: { end: 'finalColor = vec3(0.0, 2.0 * templateGain, 0.0); alpha = 1.0;' } },
};

interface ShiftData {
  uShift: number;
  uPassShift: number;
}

async function greenPassView(preference: 'webgpu' | 'webgl', id: string) {
  const app = await getApp<Renderer>({
    id: `pass-level-${id}-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x0000ff },
  });
  const view3d = new View3D({
    width: SIZE,
    height: SIZE,
    passes: [
      new MeshPass({
        name: 'green',
        level: 'shape',
        descriptor: { shaderDescriptor: { bitsGpu: [greenBit], bitsGl: [greenBit] }, state: new State() },
      }),
    ],
  });
  view3d.camera.position.set(0, 0, 10);
  app.stage.addChild(view3d);

  return { app, view3d };
}

function greenInMiddleRow(pixels: Uint8ClampedArray): { left: number; right: number } {
  const row = (SIZE / 2) * SIZE * 4;
  const count = { left: 0, right: 0 };

  for (let x = 0; x < SIZE; x++) {
    const [r, g, b] = [pixels[row + x * 4], pixels[row + x * 4 + 1], pixels[row + x * 4 + 2]];
    if (g > 200 && r < 60 && b < 60) count[x < SIZE / 2 ? 'left' : 'right']++;
  }

  return count;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a pass with a level (${preference})`, () => {
    it("draws a mesh where its material's shape bit puts it, with the pass's own colour", async () => {
      const { app, view3d } = await greenPassView(preference, 'shift');

      try {
        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          material: new Material3D({ baseColor: 0xff0000, extraBits: [shiftBit], passes: { green: true } }),
        });
        mesh.position.set(-2, 0, 0);
        view3d.root.addChild(mesh);

        const green = greenInMiddleRow(await renderFrame(app));
        expect(green.right, 'the pass drew the mesh four units to the right, where the bit moved it').toBeGreaterThan(
          4,
        );
        expect(green.left, 'and not where the mesh sits before the bit runs').toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('turns a billboard mesh to the camera, as its own pass does', async () => {
      const { app, view3d } = await greenPassView(preference, 'billboard');

      try {
        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 2, height: 2, depth: 0.01 }),
          material: new Material3D({ baseColor: 0xff0000, passes: { green: true } }),
        });
        mesh.rotation.y = Math.PI / 2;
        view3d.root.addChild(mesh);

        const edgeOn = greenInMiddleRow(await renderFrame(app));
        expect(edgeOn.left + edgeOn.right, 'edge on, the slab covers no pixel centre').toBeLessThan(3);

        mesh.billboardMode = 'spherical';
        const facing = greenInMiddleRow(await renderFrame(app));
        expect(facing.left, 'the slab faces the camera across the centre').toBeGreaterThan(4);
        expect(facing.right).toBeGreaterThan(4);
      } finally {
        app.destroy();
      }
    });

    it('reads a per-material value in a shape bit, and binds the material for it', async () => {
      const { app, view3d } = await greenPassView(preference, 'material-data');

      try {
        const material = new Material3D({
          baseColor: 0xff0000,
          extraBits: [materialShiftBit],
          passes: { green: true },
        });
        (material.data as Material3DData & ShiftData).uShift = 4;

        const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });
        mesh.position.set(-2, 0, 0);
        view3d.root.addChild(mesh);

        const green = greenInMiddleRow(await renderFrame(app));
        expect(green.right, "the pass moved the mesh by the material's own amount").toBeGreaterThan(4);
        expect(green.left).toBe(0);

        const list = view3d._sceneBatch.drawLists[passBitRegistry.getOrAllocate('green')];
        expect(list.commandList.commands[0].batchBindGroup, 'the draw binds the material it reads').toBeDefined();
      } finally {
        app.destroy();
      }
    });

    it('binds the material for a kept bit that reads it only through a bit it requires', async () => {
      const { app, view3d } = await greenPassView(preference, 'requires');

      try {
        const material = new Material3D({
          baseColor: 0xff0000,
          extraBits: [droppedShiftBit, requiringBit],
          passes: { green: true },
        });
        (material.data as Material3DData & ShiftData).uShift = 4;

        const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });
        mesh.position.set(-2, 0, 0);
        view3d.root.addChild(mesh);

        const green = greenInMiddleRow(await renderFrame(app));
        expect(green.right, 'the required bit moved the mesh in the pass').toBeGreaterThan(4);
        expect(green.left).toBe(0);

        const list = view3d._sceneBatch.drawLists[passBitRegistry.getOrAllocate('green')];
        expect(list.commandList.commands[0].batchBindGroup, 'the draw binds the material').toBeDefined();
      } finally {
        app.destroy();
      }
    });

    it('adds the bits a material lists for the pass, and leaves them out of its main pass', async () => {
      const { app, view3d } = await greenPassView(preference, 'entry-bits');

      try {
        const material = new Material3D({ baseColor: 0xff0000, passes: { green: { extraBits: [passShiftBit] } } });
        (material.data as Material3DData & ShiftData).uPassShift = 4;

        const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });
        mesh.position.set(-2, 0, 0);
        view3d.root.addChild(mesh);

        const pixels = await renderFrame(app);
        const green = greenInMiddleRow(pixels);
        expect(green.right, 'the green pass drew the mesh where the entry bit moved it').toBeGreaterThan(4);
        expect(green.left).toBe(0);

        const row = (SIZE / 2) * SIZE * 4;
        let mainPassLeft = 0;
        for (let x = 0; x < SIZE / 2; x++) {
          if (pixels[row + x * 4 + 2] < 128) mainPassLeft++;
        }
        expect(mainPassLeft, 'the main pass drew the mesh where it sits, unmoved').toBeGreaterThan(4);
      } finally {
        app.destroy();
      }
    });

    it('draws materials that bring no data in one command that binds no material', async () => {
      const { app, view3d } = await greenPassView(preference, 'no-data');

      try {
        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        for (let i = 0; i < 6; i++) {
          const material = new Material3D({ baseColor: 0x202020 * (i + 1), passes: { green: true } });
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.set(i - 2.5, 0, 0);
          view3d.root.addChild(mesh);
        }

        await renderFrame(app);

        const list = view3d._sceneBatch.drawLists[passBitRegistry.getOrAllocate('green')];
        expect(list.commandList.count, "one geometry and one shader: the materials don't split the draw").toBe(1);
        expect(list.commandList.commands[0].batchBindGroup).toBeUndefined();
      } finally {
        app.destroy();
      }
    });

    it("draws a material's shader for the pass as it is when it brings a template, whatever the pass's level", async () => {
      const { app, view3d } = await greenPassView(preference, 'whole');

      try {
        const whole = {
          bitsGpu: [wholeGreenBit],
          bitsGl: [instanceFetchBitGl, wholeGreenBit],
          template: wholeGreenTemplate,
        };
        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          material: new Material3D({
            baseColor: 0xff0000,
            extraBits: [shiftBit],
            passes: { green: { shaderDescriptor: whole } },
          }),
        });
        mesh.position.set(-2, 0, 0);
        view3d.root.addChild(mesh);

        const green = greenInMiddleRow(await renderFrame(app));
        expect(green.left, 'the whole shader drew the mesh where it sits').toBeGreaterThan(4);
        expect(green.right, "and took none of the material's bits, so the shape bit moved nothing").toBe(0);
      } finally {
        app.destroy();
      }
    });

    it("keeps a material's own template in a pass at level 'color'", async () => {
      const app = await getApp<Renderer>({
        id: `pass-level-colour-template-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x0000ff },
      });
      const consoleError = vi.spyOn(console, 'error');

      try {
        const view3d = new View3D({
          width: SIZE,
          height: SIZE,
          passes: [new MeshPass({ name: 'colourLevel', level: 'color', descriptor: { state: new State() } })],
        });
        view3d.camera.position.set(0, 0, 10);
        app.stage.addChild(view3d);

        const material = new BaseMaterial3D({
          descriptor: { bitsGpu: [templateGainBit], bitsGl: [templateGainBit], template: gainTemplate },
          passes: { colourLevel: true },
        });
        const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }), material });
        mesh.disablePass('opaque');
        view3d.root.addChild(mesh);

        const green = greenInMiddleRow(await renderFrame(app));
        expect(
          green.left + green.right,
          "the 'color' pass drew the mesh with the local its template declares",
        ).toBeGreaterThan(8);
        expect(
          consoleError.mock.calls.filter((args) => args.some((arg) => String(arg).includes('templateGain'))),
          'no shader failed to compile on templateGain',
        ).toEqual([]);
      } finally {
        consoleError.mockRestore();
        app.destroy();
      }
    });

    it('throws, naming the pass, for a shader with no template on a pass with no level', async () => {
      const app = await getApp<Renderer>({
        id: `pass-level-no-template-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const pass = new MeshPass({
          name: 'no-template',
          descriptor: { shaderDescriptor: { bitsGpu: [greenBit], bitsGl: [greenBit] } },
        });
        const view3d = new View3D({ width: SIZE, height: SIZE, passes: [pass] });
        app.stage.addChild(view3d);
        view3d.root.addChild(
          new Mesh3D({
            geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
            material: new Material3D({ passes: { 'no-template': true } }),
          }),
        );

        expect(() => app.render()).toThrow(/'no-template' pass draws Material3D with a shader that has no template/);
      } finally {
        app.destroy();
      }
    });
  });
}
