import { DrawCommandList } from '../batcher/DrawCommandList';
import type { Mesh3DData, MeshPassCache } from '../batcher/Mesh3DData';
import { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { pipelineState } from '../batcher/updateMesh3DKeys';
import { DrawArgs } from '../buffers/DrawArgs';
import { RenderInstanceBuffer } from '../buffers/RenderInstanceBuffer';
import type { RenderInstanceTexture } from '../buffers/RenderInstanceTexture';

interface DrawListOptions {
  items: Mesh3DData[];
  label: string;
  bit: number;
  initialCapacity?: number;
}

interface GlData {
  indexTexture: RenderInstanceTexture | null;
  /** The records before culling, kept apart from `indexTexture` so every draw compacts from them afresh */
  indexStaging: Uint32Array | null;
  lastVisibilityDirtyId: number;
}

interface GpuData {
  /** The records before culling; each pass's `CullResult` writes its survivors elsewhere */
  instanceBuffer: RenderInstanceBuffer;
  /** Bumped when a bundle must re-record while the draw commands stay valid; each pass keeps its own watermark */
  bundleDirtyId: number;
}

/** Scratch every list's {@link DrawList.applyEdits} shares, since no two edits run at once */
let editRecords = new Uint32Array(0);
let editCursors = new Uint32Array(0);

const NO_COMMAND = -1;

/** `_rowCommand` holds `JOINING_BASE - k` for a row joining command `k`, so it isn't taken for one that stayed */
const JOINING_BASE = -2;

/** Tail commands a list holds before it rebuilds; each is a live draw outside the bundle on indirect WebGPU */
const TAIL_COMMAND_CAP = 64;

/** Scene updates a tail may stand with no new command before the list rebuilds it into the body */
const TAIL_QUIET_FRAMES = 60;

function kindHash(batchKey: number, textureSetId: number): number {
  const h =
    Math.imul(batchKey >>> 0, 0x9e3779b1) ^
    Math.imul((batchKey / 0x1_0000_0000) >>> 0, 0x85ebca6b) ^
    Math.imul(textureSetId, 0xc2b2ae35);

  return h ^ (h >>> 15);
}

/**
 * The meshes of one pass bit on one batch, the commands that draw them, and one record per mesh grouped by command
 *
 * Every pass on the bit shares it; what a camera's cull decides lives in each pass's `CullResult` on WebGPU.
 * @internal
 */
export class DrawList {
  /** Between rebuilds only its members are current: `view.indices` keeps the last rebuild's order */
  public view: SortedMesh3DView<Mesh3DData>;

  /** Bumped when a change needs a rebuild rather than an {@link applyEdits} */
  public drawDirtyId = 0;

  public lastDrawDirtyId = -1;
  public lastOrderDirtyId = -1;

  /**
   * Bumped when {@link applyEdits} moves the commands' ranges or adds a tail command; each `CullResult`
   * re-copies its args on it
   */
  public rangesDirtyId = 0;

  public readonly bit: number = 0;
  public commandList = new DrawCommandList();

  /** The draw args; WebGL's draws rewrite its instance counts in place, and each WebGPU `CullResult` culls a copy */
  public drawData = new DrawArgs();

  public gpuData: GpuData;
  public glData: GlData;

  /** The command drawing each store row, or `NO_COMMAND`; sized by the batch's store, not by every mesh ever met */
  private _rowCommand: Int32Array = new Int32Array(0);

  /** Members each command holds; the instance-count lane can't serve, since WebGL's draws rewrite it */
  private _memberCounts = new Uint32Array(0);

  /** 1 for each command a member left since the last {@link applyEdits} */
  private _left = new Uint8Array(0);

  /** Body commands with no member; the list rebuilds once they outnumber the rest */
  private _deadCount = 0;

  private _recordCount = 0;

  /** Item indices of the members waiting for a command; indices, so a mesh destroyed meanwhile isn't kept */
  private _joining = new Uint32Array(64);

  private _joiningCount = 0;
  private _firstEdited = Infinity;
  private _readDirtyId = -1;

  /** Set under `cache: 'never'`, whose list rebuilds every frame and takes no edits */
  private _alwaysRebuilt = false;

  /** The commands by kind: an open-addressed table of command index plus one, probed from `kindHash` */
  private _kinds = new Int32Array(0);

  /** Places of {@link _kinds} in use, or -1 when the table is stale */
  private _kindsUsed = -1;

  private _edited = false;
  private _quietFrames = 0;
  private _lastQuietTick = -1;
  private _destroyed = false;

  constructor(options: DrawListOptions) {
    this.view = new SortedMesh3DView<Mesh3DData>(options.items, options.initialCapacity);
    this.bit = options.bit;

    this.glData = {
      indexTexture: null,
      indexStaging: null,
      lastVisibilityDirtyId: -1,
    };

    this.gpuData = {
      instanceBuffer: new RenderInstanceBuffer(options.label),
      bundleDirtyId: 0,
    };

    this.commandList.onCaptureLost = () => {
      this.drawDirtyId++;
    };
  }

  public get records(): Uint32Array {
    return this.glData.indexStaging ?? this.gpuData.instanceBuffer.data;
  }

  /** Whether the commands must rebuild; pure, so any phase may ask, and {@link claimDrawBuilt} claims */
  public isDrawStale(): boolean {
    return this.drawDirtyId !== this.lastDrawDirtyId || this._edited;
  }

  /**
   * Whether a pass sorted by key must rebuild the list before it draws, sorting the view when it must
   * @param updateTick - The view's `_updateTick`, so a standing tail counts each scene update once
   * @param alwaysRebuild - Whether the pass rebuilds every frame (`cache: 'never'`)
   */
  public nextBuild(updateTick: number, alwaysRebuild = false): boolean {
    this._alwaysRebuilt = alwaysRebuild;
    if (!alwaysRebuild && !this.isDrawStale()) {
      const commandList = this.commandList;
      if (commandList.count === commandList.bodyCount || updateTick === this._lastQuietTick) return false;
      this._lastQuietTick = updateTick;
      if (++this._quietFrames < TAIL_QUIET_FRAMES) return false;
      this.drawDirtyId++;
    }

    this._quietFrames = 0;
    this._edited = false;
    this.view.sort();
    return true;
  }

  public isOrderStale(): boolean {
    return this.view.orderDirtyId !== this.lastOrderDirtyId;
  }

  /** Claims the draw watermarks; call only where the build ran, after the sort it used */
  public claimDrawBuilt(): void {
    this.lastDrawDirtyId = this.drawDirtyId;
    this.lastOrderDirtyId = this.view.orderDirtyId;
  }

  /** Claims the draw watermark for a list that built nothing because it has no members */
  public claimDrawEmpty(): void {
    this.lastDrawDirtyId = this.drawDirtyId;
  }

  /** Adds a mesh; {@link applyEdits} gives it a command */
  public add(item: Mesh3DData, index: number): void {
    const editable = this._editable();
    this.view.add(item.uid, index, item._sortKey);
    if (editable) this._queueJoin(index);
    this._edited = true;
  }

  /** Removes a mesh; call while it still holds its store row */
  public remove(item: Mesh3DData): void {
    if (this._editable()) this._dropFromCommand(item._storeIndex);
    this.view.remove(item.uid);
    this._edited = true;
  }

  /** Takes a member whose kind may have changed out of its command, for {@link applyEdits} to place again */
  public move(item: Mesh3DData): void {
    if (this._editable() && this._dropFromCommand(item._storeIndex)) this._queueJoin(this.view.indexOf(item.uid));
    this._edited = true;
  }

  /**
   * Brings the commands up to the view's members without a rebuild, or bumps {@link drawDirtyId}
   * when they can't take the edit; runs once a frame, at the end of the scene update
   */
  public applyEdits(): void {
    if (!this._edited) return;
    this._edited = false;
    if (this.lastDrawDirtyId < 0) return;

    if (!this._editable() || !this._repack()) {
      this._joiningCount = 0;
      this.drawDirtyId++;
    }
  }

  /** Whether the commands can take an edit; ask before changing the view, so the records still match it */
  private _editable(): boolean {
    const commandList = this.commandList;
    if (
      this.drawDirtyId !== this.lastDrawDirtyId ||
      commandList.count === 0 ||
      this._alwaysRebuilt ||
      this.view.orderForced
    ) {
      return false;
    }
    if (this._readDirtyId !== commandList.dirtyId) this._readBuild();
    return true;
  }

  private _readBuild(): void {
    const commandList = this.commandList;
    const commandCount = commandList.count;
    const drawCalls = this.drawData.drawCalls;
    const records = this.records;
    const total = this.view.count;

    const capacity = commandCount + TAIL_COMMAND_CAP;
    if (this._memberCounts.length < capacity) {
      this._memberCounts = new Uint32Array(capacity * 2);
      this._left = new Uint8Array(capacity * 2);
    }
    const counts = this._memberCounts;
    this._left.fill(0);
    let rowCommand = this._rowCommand.fill(NO_COMMAND);

    for (let k = 0; k < commandCount; k++) {
      const start = drawCalls[k * 5 + 4];
      const end = k + 1 < commandCount ? drawCalls[(k + 1) * 5 + 4] : total;
      counts[k] = end - start;
      for (let i = start; i < end; i++) {
        const row = records[i];
        if (row >= rowCommand.length) rowCommand = this._growRows(row + 1);
        rowCommand[row] = k;
      }
    }

    this._recordCount = total;
    this._deadCount = 0;
    this._joiningCount = 0;
    this._firstEdited = Infinity;
    this._kindsUsed = -1;
    this._readDirtyId = commandList.dirtyId;
  }

  /** Grows {@link _rowCommand}; it doubles, but past 256 rows never beyond what the batch's store can hold */
  private _growRows(minLength: number): Int32Array {
    const doubled = Math.min(this._rowCommand.length * 2, this.view.items.length + 1);
    const grown = new Int32Array(Math.max(minLength, doubled, 256)).fill(NO_COMMAND);
    grown.set(this._rowCommand);

    return (this._rowCommand = grown);
  }

  private _queueJoin(index: number): void {
    if (this._joiningCount === this._joining.length) {
      if (this._joiningCount >= this.view.items.length) {
        this._joiningCount = 0;
        this.drawDirtyId++;
        return;
      }
      const grown = new Uint32Array(this._joining.length * 2);
      grown.set(this._joining);
      this._joining = grown;
    }
    this._joining[this._joiningCount++] = index;
  }

  /**
   * Drops a store row from its command; once dead body commands outnumber live ones the list
   * rebuilds, since each costs a zero-instance draw in every bundle replay
   * @returns Whether a command drew the row
   */
  private _dropFromCommand(row: number): boolean {
    const rowCommand = this._rowCommand;
    if (row < 0 || row >= rowCommand.length) return false;
    const k = rowCommand[row];
    if (k < 0) return false;

    rowCommand[row] = NO_COMMAND;
    this._left[k] = 1;
    if (k < this._firstEdited) this._firstEdited = k;
    if (--this._memberCounts[k] > 0) return true;

    const commandList = this.commandList;
    if (k >= commandList.bodyCount) commandList.releaseTail(commandList.commands[k]);
    else if (++this._deadCount * 2 > commandList.bodyCount) this.drawDirtyId++;
    return true;
  }

  /**
   * Places the waiting members and lays the records out again; the body of {@link applyEdits}
   * @returns `false` when the list must rebuild instead
   */
  private _repack(): boolean {
    const view = this.view;
    const items = view.items;
    const bit = this.bit;
    const joining = this._joining;
    let rowCommand = this._rowCommand;
    let first = this._firstEdited;
    let joined = 0;

    for (let p = 0; p < this._joiningCount; p++) {
      const item = items[joining[p]] as Mesh3DData | null;
      if (!item || (item._lastRenderPass & bit) === 0) continue;
      const row = item._storeIndex;
      if (row >= rowCommand.length) rowCommand = this._growRows(row + 1);
      if (rowCommand[row] !== NO_COMMAND) continue;

      const cache = item._passCache[bit];
      if (!cache) return false;
      let k = this._find(item, cache);
      if (k < 0) {
        k = this._record(item, cache);
        if (k < 0) return false;
      }
      if (this._memberCounts[k]++ === 0 && k < this.commandList.bodyCount) this._deadCount--;
      rowCommand[row] = JOINING_BASE - k;
      joining[joined++] = row;
      if (k < first) first = k;
    }
    this._joiningCount = 0;
    this._firstEdited = Infinity;

    const commandList = this.commandList;
    const bodyCount = commandList.bodyCount;
    const counts = this._memberCounts;
    const builtCount = commandList.count;
    while (commandList.count > bodyCount && counts[commandList.count - 1] === 0) commandList.count--;
    const commandCount = commandList.count;
    if (first === Infinity) return true;
    if (first > commandCount) first = commandCount;

    const count = view.count;
    if (editRecords.length < count) editRecords = new Uint32Array(Math.ceil(count * 1.5));
    if (editCursors.length < commandCount) editCursors = new Uint32Array(commandCount * 2);
    const out = editRecords;
    const cursors = editCursors;
    const records = this.records;
    const recordCount = this._recordCount;
    const commands = commandList.commands;
    const drawCalls = this.drawData.drawCalls;
    const left = this._left;
    const base = drawCalls[first * 5 + 4];
    let at = base;
    let revived = false;

    for (let k = first; k < commandCount; k++) {
      const command = commands[k];
      const members = counts[k];
      const start = drawCalls[k * 5 + 4];
      const end = k + 1 < builtCount ? drawCalls[(k + 1) * 5 + 4] : recordCount;
      drawCalls[k * 5 + 4] = at;
      drawCalls[k * 5 + 1] = members;
      if (left[k] === 0) {
        for (let i = start; i < end; i++) out[at++] = records[i];
      } else {
        left[k] = 0;
        for (let i = start; i < end; i++) {
          const row = records[i];
          if (rowCommand[row] >= 0) out[at++] = row;
        }
      }
      cursors[k] = at;
      at = drawCalls[k * 5 + 4] + members;
      if (command.leftOut && members > 0 && k < bodyCount) {
        revived = true;
        command.leftOut = false;
      }
      command.dead = members === 0;
    }
    if (at !== count) return false;

    for (let p = 0; p < joined; p++) {
      const row = joining[p];
      const k = JOINING_BASE - rowCommand[row];
      rowCommand[row] = k;
      out[cursors[k]++] = row;
    }

    const moved = out.subarray(base, count);
    const glData = this.glData;
    if (glData.indexStaging) {
      const indexTexture = glData.indexTexture!;
      indexTexture.ensureCapacity(count);
      if (records.length < indexTexture.data.length) {
        glData.indexStaging = new Uint32Array(indexTexture.data.length);
        glData.indexStaging.set(records.subarray(0, base));
      }
      glData.indexStaging.set(moved, base);
      glData.lastVisibilityDirtyId = -1;
    } else {
      if (count > base) {
        const instanceBuffer = this.gpuData.instanceBuffer;
        const grown = instanceBuffer.ensureSize(count);
        if (grown !== records) grown.set(records.subarray(0, base));
        grown.set(moved, base);
        instanceBuffer.upload(count, grown !== records ? 0 : base);
      }
      if (revived) this.gpuData.bundleDirtyId++;
    }

    this._recordCount = count;
    this.rangesDirtyId++;

    return true;
  }

  /** The command that draws a member's kind, or -1 */
  private _find(item: Mesh3DData, cache: MeshPassCache): number {
    if (this._kindsUsed < 0) this._indexKinds();

    const kinds = this._kinds;
    const mask = kinds.length - 1;
    const bound = this.commandList.commands[0].batchBindGroup ? item.material._textureSetId : 0;

    for (let h = kindHash(cache.batchKey, bound) & mask; ; h = (h + 1) & mask) {
      const entry = kinds[h];
      if (entry === 0) return -1;
      if (this._fits(entry - 1, item, cache)) return entry - 1;
    }
  }

  /** Fills {@link _kinds} with every command, sized so at most half its places are in use */
  private _indexKinds(): void {
    const commandList = this.commandList;
    const commandCount = commandList.count;
    let size = 256;
    while (size < (commandCount + TAIL_COMMAND_CAP) * 2) size *= 2;

    if (this._kinds.length === size) this._kinds.fill(0);
    else this._kinds = new Int32Array(size);

    this._kindsUsed = 0;
    for (let k = 0; k < commandCount; k++) this._indexKind(k);
  }

  /** Enters a command in {@link _kinds}; once half full it is refilled on the next {@link _find} */
  private _indexKind(k: number): void {
    const kinds = this._kinds;
    const mask = kinds.length - 1;
    const command = this.commandList.commands[k];
    let h = kindHash(command.batchKey, command.textureSetId) & mask;
    while (kinds[h] !== 0) h = (h + 1) & mask;
    kinds[h] = k + 1;
    if (++this._kindsUsed * 2 > kinds.length) this._kindsUsed = -1;
  }

  /**
   * Whether command `k` draws `item`'s kind, compared exactly; an empty tail command has released its
   * captures (`DrawCommandList.releaseTail`), and the atlas range keeps a mesh out of a command drawing
   * the range its geometry left
   */
  private _fits(k: number, item: Mesh3DData, cache: MeshPassCache): boolean {
    const commandList = this.commandList;
    const command = commandList.commands[k];
    if (cache.batchKey !== command.batchKey) return false;
    if (k >= commandList.bodyCount && this._memberCounts[k] === 0) return false;

    const alloc = item.geometry._geometryAtlasAllocation;
    if (command.geometry !== (alloc ? alloc.atlas.geometry : item.geometry)) return false;
    if (alloc) {
      const drawCalls = this.drawData.drawCalls;
      if (drawCalls[k * 5] !== alloc.indexCount || drawCalls[k * 5 + 2] !== alloc.firstIndex) return false;
    }

    const group = command.batchBindGroup;
    if (!group) return true;

    return command.merged
      ? command.textureSetId === item.material._textureSetId
      : group === item.material._getBindGroup();
  }

  /**
   * Records a tail command for a kind no command draws; a list's commands all carry a material
   * group or none do, as the batchers build them, so the first says which
   * @returns The command's index, or -1 when the tail is full
   */
  private _record(item: Mesh3DData, cache: MeshPassCache): number {
    const commandList = this.commandList;
    const commands = commandList.commands;
    let k = commandList.bodyCount;
    while (k < commandList.count && this._memberCounts[k] > 0) k++;

    if (k === commandList.count) {
      if (k - commandList.bodyCount === TAIL_COMMAND_CAP) return -1;
      commandList.next();
      this._memberCounts[k] = 0;
      this.drawData.ensureCapacity(k + 1)[k * 5 + 4] = this._recordCount;
    }

    const webgl = this.glData.indexStaging !== null;
    const bindsMaterial = commands[0].batchBindGroup !== undefined;
    const material = item.material;
    const alloc = item.geometry._geometryAtlasAllocation;
    const geometry = alloc ? alloc.atlas.geometry : item.geometry;
    const command = commands[k];

    commandList.captureTail(command, geometry, bindsMaterial ? material : null);
    command.geometry = geometry;
    command.shader = cache.shader;
    command.globalBindGroup = commands[0].globalBindGroup;
    command.batchBindGroup = bindsMaterial
      ? webgl
        ? material._getMergedBindGroup()
        : material._getBindGroup()
      : undefined;
    command.state = pipelineState(cache.batchKey, cache.state);
    command.topology = cache.topology;
    command.batchKey = cache.batchKey;
    command.textureSetId = bindsMaterial ? material._textureSetId : 0;
    command.merged = bindsMaterial && webgl;
    command.dead = false;
    command.leftOut = false;

    const drawCalls = this.drawData.drawCalls;
    drawCalls[k * 5] = alloc ? alloc.indexCount : geometry.indexCount || geometry.indexBuffer.data.length;
    drawCalls[k * 5 + 2] = alloc ? alloc.firstIndex : 0;
    drawCalls[k * 5 + 3] = alloc && !webgl ? alloc.baseVertex : 0;

    if (this._kindsUsed >= 0) this._indexKind(k);
    this._quietFrames = 0;

    return k;
  }

  /** Frees the GPU memory and the captures of the build, keeping the CPU state; the next frame rebuilds */
  public unload(): void {
    if (this._destroyed) return;

    this.commandList.releaseCaptures();
    this.drawDirtyId++;

    this.gpuData.bundleDirtyId++;
    this.gpuData.instanceBuffer.unload();
    this.glData.indexTexture?.unload();
  }

  /** Releases what this list owns alone; the shaders, geometry and bind groups its commands use are shared */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this.gpuData.instanceBuffer.destroy();

    this.glData.indexTexture?.destroy();
    this.glData.indexTexture = null;
    this.glData.indexStaging = null;

    (this.view as SortedMesh3DView<Mesh3DData> | null) = null;
    this.commandList.destroy();
    this.drawData.destroy();
  }
}
