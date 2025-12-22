import { TCommit, TObjects, TTree } from "../repo/objects";
import { BaseEntry, TreeEntry } from "../repo/entries";
import type { PathFilter } from "./path-filter";

export type DiffMap = Map<string, [BaseEntry | null, BaseEntry | null]>;

export class TreeDiff {
    private _changes: DiffMap;

    constructor(
        private _objects: TObjects
    ) {
        this._changes = new Map();
    }

    get changes(): ReadonlyMap<string, [BaseEntry | null, BaseEntry | null]> {
        return this._changes;
    }

    async compareOids(aHash: string | null, bHash: string | null, filter: PathFilter) {
        if (aHash === bHash) return;

        const aEntries = !aHash ? new Map<string, TreeEntry>() : (await this._oidToTree(aHash))?.entries as Map<string, TreeEntry>;
        const bEntries = !bHash ? new Map<string, TreeEntry>(): (await this._oidToTree(bHash))?.entries as Map<string, TreeEntry>;

        await this._detectDeletions(aEntries, bEntries, filter);
        await this._detectAdditions(aEntries, bEntries, filter);
    }

    async _detectDeletions(aEntries: Map<string, TreeEntry>, bEntries:  Map<string, TreeEntry>, filter: PathFilter) {
        for (const [name, entry] of aEntries) {
            const other = bEntries.get(name);
    
            if (entry === other) 
                continue;

            const subFilter = filter.join(name);
    
            // Get tree OIDs if entries are trees, otherwise null
            const treeA = entry.isTree() ? entry.hash : null;
            const treeB = other?.isTree() ? other.hash : null;

            // Recursively compare tree OIDs
            await this.compareOids(treeA, treeB, subFilter);

            // Get blob entries (non-trees)
            const blobA = entry.isTree() ? null : entry;
            const blobB = other?.isTree() ? null : other;

            // Store changes if either blob exists
            if (blobA || blobB) {
                this._changes.set(subFilter.path, [blobA, blobB || null]);
            }
        }
    }

    async _detectAdditions(aEntries: Map<string, TreeEntry>, bEntries: Map<string, TreeEntry>, filter: PathFilter) {
        for (const [name, entry] of filter.eachEntry(bEntries)) {
            const other = aEntries.get(name);
    
            // Skip if entry exists in 'a'
            if (other) continue;
    
            const subFilter = filter.join(name);
    
            if (entry.isTree()) {
                // Entry is a tree - recursively compare
                await this.compareOids(null, entry.hash, subFilter);
            } else {
                // Entry is a blob - record as addition
                this._changes.set(subFilter.path, [null, entry]);
            }
        }
    }

    async _oidToTree(oid: string): Promise<TTree | null> {
        const object = await this._objects.readObject(oid);
        
        if (object instanceof TCommit) {
            return await this._objects.loadTree(object.treeHash);
        } else if (object instanceof TTree) {
            return object;
        }
        
        return null;
    }
}