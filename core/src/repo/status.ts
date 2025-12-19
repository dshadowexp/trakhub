import { Stats } from "node:fs";
import { sep } from "node:path";
import { DiffField, DiffAction } from "../types";
import { TRepository } from "./repository";
import { IndexEntry, TreeEntry } from "./entries";
import { TBlob } from "./objects";
import { Inspector } from "../lib/inspector";

export class TStatus {
    private _inspector: Inspector;
    private _untracked: Set<string>;
    private _changed: Set<string>;
    private _indexChanges: Map<string, DiffAction>;
    private _workspaceChanges: Map<string, DiffAction>;
    private _stats: Map<string, Stats>;
    private _headTree: Map<string, TreeEntry>;
    private _conflicts: Map<string, number[]>;

    constructor(private _repo: TRepository) {
        this._inspector = new Inspector(_repo);
        this._untracked = new Set();
        this._changed = new Set();
        this._workspaceChanges = new Map();
        this._indexChanges = new Map();
        this._stats = new Map();
        this._headTree = new Map();
        this._conflicts = new Map();
    }

    get untracked() { return this._untracked; }
    get changed() { return this._changed; }
    get workspaceChanges() { return this._workspaceChanges; }
    get indexChanges() { return this._indexChanges; }
    get stats() { return this._stats; }
    get headTree() { return this._headTree; }
    get conflicts() { return this._conflicts; }

    async initialize() {
        await this._scanWorkspace();
        await this._loadHeadTree();
        await this._checkIndexEntries();
        this._collectionDeletedHeadFiles();
    }

    private async _scanWorkspace(prefix: string | undefined = undefined) {
        for (const [path, stat] of await this._repo!.workspace.listFiles(prefix)) {
            if (this._repo!.index.isTracked(path)) {
                if (stat.isFile()) this._stats.set(path, stat);
                if (stat.isDirectory()) await this._scanWorkspace(path);
            } else if (await this._inspector.trackableFile(path, stat)) {
                const trackedPath = stat.isDirectory() ? `${ path }${ sep }` : path;
                this._untracked.add(trackedPath);
            }
        }
    }

    private async _recordChange(path: string, field: DiffField, action: DiffAction) {
        this._changed.add(path);
        const changes = field === DiffField.WORKSPACE ? this._workspaceChanges : this._indexChanges;
        changes.set(path, action);
    }

    private async _loadHeadTree() {
        const headCommitHash = await this._repo!.refs.readHead();
        if (!headCommitHash) return;

        const headCommit = await this._repo!.objects.loadCommit(headCommitHash);
        await this._readTree(headCommit.treeHash);
    }

    private async _readTree(treeHash: string, prefix: string = "") {
        const tree = await this._repo!.objects.loadTree(treeHash);
        for (const [name, entry] of tree.entries.entries()) {
            const fullPath = `${ prefix }${ name }`;
            const type = entry.mode.startsWith("100") ? "blob" : "tree";
            if (type === "tree") { //if (entry.isTree()) {
                await this._readTree(entry.hash!, `${ fullPath }${ sep }`);
            } else {
                this._headTree.set(fullPath, entry as TreeEntry);
            }
        }
    }

    private async _checkIndexEntries() {
        for (const entry of this._repo!.index.eachEntry()) {
            if (entry.stage === 0) {
                await this._checkIndexAgainstWorkspace(entry);
                await this._checkIndexAgainstHeadTree(entry);
            } else {
                this._changed.add(entry.path);
                if (!this._conflicts.has(entry.path))
                    this._conflicts.set(entry.path, []);
                this._conflicts.get(entry.path)!.push(entry.stage);
            }
        }
    }

    private async _checkIndexAgainstHeadTree(entry: IndexEntry) {
        const item = this._headTree.get(entry.path);
        const status = this._inspector.compareTreeToIndex(item, entry);
        if (status) {
            this._recordChange(entry.path, DiffField.INDEX, status);   
        }
    }

    private async _checkIndexAgainstWorkspace(entry: IndexEntry) {
        const stat = this._stats.get(entry.path);
        const status = await this._inspector.compareIndexToWorkspace(entry, stat);

        if (status) {
            this._recordChange(entry.path, DiffField.WORKSPACE, DiffAction.MODIFY);
        } else {
            this._repo!.index.updateEntryStat(entry, stat!); // TODO: investigate the stat being null
        }
    }

    private _collectionDeletedHeadFiles() {
        for (const path of this._headTree.keys()) {
            if (!this._repo!.index.isTrackedFile(path)) {
                this._recordChange(path, DiffField.INDEX, DiffAction.DELETE);
            }
        }
    }
}