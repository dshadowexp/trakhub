import { join } from "path";
import { TObjects } from "../repo/objects";
import { DiffAction, UnixFileModeEnum } from "../types";
import { BaseEntry, TreeEntry } from "../repo/entries";

export type DiffEntry = {
    action: DiffAction
    path: string
    old?: BaseEntry
    new?: BaseEntry
}

export class TreeDiff {
    //private _changes: Map<string, [TreeEntry | null | undefined, TreeEntry | null | undefined]>;
    private _changes: DiffEntry[];

    constructor(
        private _objects: TObjects
    ) {
        this._changes = [];
    }

    // async compareHashes(aHash: string | null, bHash: string | null, prefix: string = "") {
    //     if (aHash === bHash) return;

    //     const aEntries = !aHash ? new Map<string, TreeEntry>() : (await this._objects.loadTree(aHash)).entries as Map<string, TreeEntry>;
    //     const bEntries = !bHash ? new Map<string, TreeEntry>(): (await this._objects.loadTree(bHash)).entries as Map<string, TreeEntry>;

    //     await this._detectDeletions(aEntries, bEntries, prefix);
    //     await this._detectAdditions(aEntries, bEntries, prefix);
    // }

    // async _detectDeletions(aEntries: Map<string, TreeEntry>, bEntries:  Map<string, TreeEntry>, prefix: string) {
    //     for (const [name, entry] of aEntries) {
    //         const path = join(prefix, name);
    //         const other = bEntries.get(name);
    
    //         if (entry === other) continue;
    
    //         // Get tree OIDs if entries are trees, otherwise null
    //         const treeA = entry.isTree() ? entry.hash : null;
    //         const treeB = other?.isTree ? other.hash : null;
    
    //         // Recursively compare tree OIDs
    //         await this.compareHashes(treeA, treeB, path);
    
    //         // Get blob entries (non-trees)
    //         const blobA = entry.isTree() ? null : entry;
    //         const blobB = other?.isTree ? null : other;
    
    //         // Store changes if either blob exists
    //         if (blobA || blobB) {
    //             this._changes.set(path, [blobA, blobB]);
    //         }
    //     }
    // }

    // async _detectAdditions(aEntries: Map<string, TreeEntry>, b:  Map<string, TreeEntry>, prefiix: string) {

    // }

    async compareTrees(treeHashA: string | null, treeHashB: string | null, prefix: string = ""): Promise<DiffEntry[]> {
        if (treeHashA === treeHashB) return [];

        let changes: DiffEntry[] = [];
        const treeAEntries = !treeHashA ? [] : (await this._objects.loadTree(treeHashA)).entries.values().toArray() as TreeEntry[];
        const treeBEntries = !treeHashB ? [] : (await this._objects.loadTree(treeHashB)).entries.values().toArray() as TreeEntry[];
    
        let indexA = 0, indexB = 0;
        let entryA: TreeEntry, entryB: TreeEntry;
    
        while (indexA < treeAEntries.length || indexB < treeBEntries.length) {
            if (indexA >= treeAEntries.length) {
                entryB = treeBEntries[indexB];
                changes.push(...(await this._detectedAddition(entryB, prefix)));
                indexB++;
            } else if (indexB >= treeBEntries.length) {
                entryA = treeAEntries[indexA];
                changes.push(...(await this._detectedDeletion(entryA, prefix)));
                indexA++;
            } else {
                entryA = treeAEntries[indexA];
                entryB = treeBEntries[indexB];
    
                const comparison = this._comparePaths(entryA, entryB);
                if (comparison < 0) {
                    changes.push(...(await this._detectedDeletion(entryA, prefix)));
                    indexA++;
                } else if (comparison > 0) {
                    changes.push(...(await this._detectedAddition(entryB, prefix)));
                    indexB++;
                } else {
                    changes.push(...(await this._detectedChange(entryA, entryB, prefix)));
                    indexA++;
                    indexB++;
                }
            }
        }
    
        return changes;
    }

    private async _detectedAddition(entry: TreeEntry, prefix: string): Promise<DiffEntry[]> {
        const fullPath = join(prefix, entry.path);

        if (entry.mode === UnixFileModeEnum.DIR) {
            // It's a tree (directory) - recurse to show all added files
            return await this.compareTrees(entry.hash, fullPath);
        } else {
            // It's a blob (file)
            return [{
                action: DiffAction.ADD, 
                path: fullPath,
                new: new BaseEntry(entry.hash, entry.mode)
            }];
        }
    }

    private async _detectedDeletion(entry: TreeEntry, prefix: string): Promise<DiffEntry[]> {
        const fullPath = join(prefix, entry.path);

        if (entry.mode === UnixFileModeEnum.DIR) {
            // It's a tree (directory) - recurse to show all deleted files
            return await this.compareTrees(entry.hash, null, fullPath);
        } else {
            // It's a blob (file)
            return [{
                action: DiffAction.DELETE, 
                path: fullPath,
                old: new BaseEntry(entry.hash, entry.mode)
            }];
        }
    }

    private async _detectedChange(entryA: TreeEntry, entryB: TreeEntry, prefix: string): Promise<DiffEntry[]> {
        const fullPath = join(prefix, entryA.path);
        // Check if modes are different (type changed)
        if (entryA.hash !== entryB.hash) {
            if ((entryA.mode === UnixFileModeEnum.DIR) || (entryB.mode === UnixFileModeEnum.DIR)) {
                // Type changed between file and directory
                let changes: DiffEntry[] = [];
                if (entryA.mode === UnixFileModeEnum.DIR) {
                    changes.push(...(await this._detectedDeletion(entryA, prefix)));
                } else {
                    return [{
                        action: DiffAction.DELETE, 
                        path: fullPath,
                        old: new BaseEntry(entryA.hash, entryA.mode)
                    }];
                }

                if (entryB.mode === UnixFileModeEnum.DIR) {
                    changes.push(...(await this._detectedAddition(entryB, prefix)));
                } else {
                    return [{
                        action: DiffAction.ADD, 
                        path: fullPath,
                        old: new BaseEntry(entryB.hash, entryB.mode)
                    }];
                }

                return changes;
            } else {
                // Both are blobs - content changed
                return [{
                    action: DiffAction.MODIFY, 
                    path: fullPath,
                    new: new BaseEntry(entryB.hash, entryB.mode),
                    old: new BaseEntry(entryA.hash, entryA.mode)
                }];
            }
        }

        // Same mode - check OID
        if (entryA.hash === entryB.hash) {
            // Identical - no change
            return [];
        }

        // Different OIDs
        if ((entryA.mode === UnixFileModeEnum.DIR) && (entryB.mode === UnixFileModeEnum.DIR)) {
            // Both are trees - recurse into subdirectory
            return await this.compareTrees(entryA.hash, entryB.hash, fullPath);
        } else {
            // Both are blobs - content changed
            return [{
                action: DiffAction.MODIFY, 
                path: fullPath,
                new: new BaseEntry(entryB.hash, entryB.mode),
                old: new BaseEntry(entryA.hash, entryA.mode)
            }];
        }
    }

    /**
     * 
     * @param entryA 
     * @param entryB 
     * @returns 
     */
    private _comparePaths(entryA: TreeEntry, entryB: TreeEntry): number {
        // Git sorts tree entries with special rules:
        // Directories are treated as having "/" appended for sorting
        const sortNameA = entryA.path + (entryA.mode === UnixFileModeEnum.DIR ? '/' : '');
        const sortNameB = entryB.path + (entryB.mode === UnixFileModeEnum.DIR ? '/' : '');

        if (sortNameA < sortNameB) return -1;
        if (sortNameA > sortNameB) return 1;
        return 0;
    }
}