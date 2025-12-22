import type { Stats } from "fs";
import { dirname, parse } from "path";
import { DiffAction } from "../types";
import { Inspector } from "./inspector";
import { type DiffEntry } from "./tree-diff";
import type { TRepository } from "../repo/repository";
import type { BaseEntry, IndexEntry, TreeEntry } from "../repo/entries";

enum MigrationConflictType {
    STALE_FILE = 'stale_file',
    STALE_DIRECTORY = 'stale_directory',
    UNTRACKED_OVERWRITTEN = 'untracked_overwritten',
    UNTRACKED_REMOVED = 'untracked_removed'
}

const MESSAGES = {
    [MigrationConflictType.STALE_FILE]: [
        "Your local changes to the following files would be overwritten by checkout:",
        "Please commit your changes or stash them before you switch branches.",
    ],
    [MigrationConflictType.STALE_DIRECTORY]: [
        "Updating the following directories would lose untracked files in them:",
        "\n",
    ],
    [MigrationConflictType.UNTRACKED_OVERWRITTEN]: [
        "The following untracked working tree files would be overwritten by checkout:",
        "Please move or remove them before you switch branches.",
    ],
    [MigrationConflictType.UNTRACKED_REMOVED]: [
        "The following untracked working tree files would be removed by checkout:",
        "Please move or remove them before you switch branches.",
    ],
} as const;

export class Migration {
    private _inspector: Inspector;
    private _changes: Map<DiffAction, [string, (BaseEntry | undefined)][]>;
    private _conflicts: Map<MigrationConflictType, Set<string>>;
    private _errors: string[];

    constructor(
        private _repo: TRepository,
        private _treeDiff: DiffEntry[]
    ) {
        this._inspector = new Inspector(_repo);
        this._changes = new Map([
            [DiffAction.DELETE, []],
            [DiffAction.MODIFY, []],
            [DiffAction.ADD, []]
        ]);
        this._conflicts = new Map([
            [MigrationConflictType.STALE_FILE, new Set<string>],
            [MigrationConflictType.STALE_DIRECTORY, new Set<string>],
            [MigrationConflictType.UNTRACKED_OVERWRITTEN, new Set<string>],
            [MigrationConflictType.UNTRACKED_REMOVED, new Set<string>]
        ]);
        this._errors = [];
    }

    get changes(): ReadonlyMap<DiffAction, [string, (BaseEntry | undefined)][]> {
        return this._changes; 
    }

    get errors(): ReadonlyArray<string> {
        return this._errors;
    }

    async applyChanges() {
        this._planChanges();
        await this._updateWorkspace();
        this._updateIndex();
    }

    async blobData(oid: string) {
        return (await this._repo.objects.loadBlob(oid)).data;
    }

    private _planChanges() {
        for (const change of this._treeDiff) {
            this._checkForConflict(change.path, change.old, change.new);
            this._changes.get(change.action)!.push([change.path, change.new]);
        }
        
        this._collectErrors();
    }

    private async _checkForConflict(path: string, oldItem: BaseEntry | undefined, newItem: BaseEntry | undefined) {
        const entry = this._repo.index.entryForPath(path);
        if (this._indexDiffersFromTrees(entry, oldItem, newItem)) {
            this._conflicts.get(MigrationConflictType.STALE_FILE)!.add(path);
            return;
        }

        const stat = this._repo.workspace.stats(path);
        const type = this._getErrorType(stat, entry, newItem);

        if (!stat) {
            const parent = await this._untrackedParent(path);
            if (parent)
                this._conflicts.get(type)!.add(entry !== undefined ? path : parent);
        } else if (stat.isFile()) {
            const changed = await this._inspector.compareIndexToWorkspace(entry, stat);
            if (changed) 
                this._conflicts.get(type)!.add(path);
        } else if (stat.isDirectory()) {
            const trackable = this._inspector.trackableFile(path, stat);
            if (!trackable)
                this._conflicts.get(type)!.add(path);
        }
    }

    private async _updateWorkspace() {
        await this._repo.workspace.applyMigration(this);
    }

    private _updateIndex() {
        this.changes.get(DiffAction.DELETE)!.map(([path, entry]) => {
            this._repo.index.remove(path);
        });

        [DiffAction.ADD, DiffAction.MODIFY].map(action => {
            this.changes.get(action)!.map(([path, entry]) => {
                if (!entry) return;
                const stat = this._repo.workspace.stats(path);
                this._repo.index.add(path, entry.hash, stat);
            });
        })
    }

    private _indexDiffersFromTrees(entry: IndexEntry | undefined, oldItem: BaseEntry | undefined, newItem: BaseEntry | undefined): boolean {
        return this._inspector.compareTreeToIndex(oldItem, entry) !== null && this._inspector.compareTreeToIndex(newItem, entry) !== null;
    }

    private _getErrorType(stat: Stats | undefined, entry: TreeEntry | undefined, item: BaseEntry | undefined): MigrationConflictType {
        if (entry) return MigrationConflictType.STALE_FILE;
        else if (stat?.isDirectory()) return MigrationConflictType.STALE_DIRECTORY;
        else if (item) return MigrationConflictType.UNTRACKED_OVERWRITTEN;
        return MigrationConflictType.UNTRACKED_REMOVED;
    }

    private async _untrackedParent(path: string): Promise<string | undefined> {
        let currentDir = dirname(path);

        while (true) {
            if (currentDir === '.' || currentDir === parse(currentDir).root) {
                return;
            }

            const parentStat = this._repo.workspace.stats(currentDir);
            if (parentStat?.isFile()) {
                if (await this._inspector.trackableFile(currentDir, parentStat)) {
                    return currentDir;
                }
            }

            const nextDir = dirname(currentDir);
            if (nextDir === currentDir)
                return;

            currentDir = nextDir;
        }
    }

    private _collectErrors() {
        for (const [type, paths] of this._conflicts.entries()) {
            if (paths.size === 0) return;
            const lines = [...paths].map(path => `\t${ path }`);
            const [header, footer] = MESSAGES[type];
            this._errors.push([header, ...lines, footer].join('\n'));
        }
    }
}

// export async function migrate(repo: TrakRepository, changes: DiffEntry[]) {
//     // Step 1: Check for conflicts
//     const conflicts = await detectConflicts(changes, repo.workTree);
//     if (conflicts.length > 0) {
//         conflicts.forEach((conflict) => Terminal.println(conflict));
//         throw new Error('Has conflicts');
//     }

//     // apply changes to directory
//     await applyChanges(repo, changes);
// }

// /**
//  * 
//  * @param changes 
//  * @param workingDirectory 
//  * @returns 
//  */
// async function detectConflicts(changes: DiffEntry[], workingDirectory: string) {
//     const conflicts: string[] = [];

//     for (const change of changes) {
//         const fullPath = join(workingDirectory, change.path);

//         switch(change.action) {
//             case DiffAction.DELETE:
//                 if (!FileSystem.exists(fullPath)) {
//                     conflicts.push(`Cannot delete non-existent: ${ fullPath }`);
//                 } else if (await isModified(fullPath, change.oldOid!)) {
//                     conflicts.push(`File modified locally: ${fullPath}`);
//                 }
//                 break;
//             case DiffAction.MODIFY:
//                 if (!FileSystem.exists(fullPath)) {
//                     conflicts.push(`Cannot modify non-existent: ${ fullPath }`);
//                 } else if (await isModified(fullPath, change.oldOid!)) {
//                     conflicts.push(`File modified locally: ${fullPath}`);
//                 }
//                 break;
//             case DiffAction.ADD:
//                 if (FileSystem.exists(fullPath)) {
//                     conflicts.push(`File already exists: ${ fullPath }`);
//                 }
//                 break;
//         }
//     }

//     return conflicts;
// }

// /**
//  * 
//  * @param path 
//  * @param expectedOid 
//  * @returns 
//  */
// async function isModified(path: string, expectedOid: string) {
//     const fileData = await FileSystem.readFile(path);
//     const blob = new TBlob(fileData);
//     return blob.hash() !== expectedOid;
// }

// /**
//  * 
//  * @param repo 
//  * @param treeDiffChanges 
//  * @param workingDirectory 
//  */
// async function applyChanges(repo: TrakRepository, treeDiffChanges: DiffEntry[]) {
//     // Group changes by type for processing order
//     const deletions: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.DELETE);
//     const modifications: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.MODIFY);
//     const additions: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.ADD);

//     // Process in order: delete, modify, add
//     // This prevents conflicts (e.g. can't add the same file if file exists)

//     // Step 1: Delete Files (in reverse depth order - files before dirs)
//     const sortDeletions = sortByDepth(deletions, true);
//     for (const diffEntry of sortDeletions) {
//         await deleteFromWorkspace(repo, diffEntry.path);
//     }

//     // Step 2: Modify Files 
//     for (const diffEntry of modifications) {
//         await updateFile(repo, diffEntry.path, diffEntry.newOid!, diffEntry.newMode!);
//     }

//     // Step 3: Add files (in depth order - dirs before files)
//     const sortAdditions = sortByDepth(additions, false);
//     for (const diffEntry of sortAdditions) {
//         await addToWorkingDirectory(repo, diffEntry.path, diffEntry.newOid!, diffEntry.newMode!);
//     }
// }

// /**
//  * 
//  * @param path 
//  * @param workingDirectory 
//  */
// async function deleteFromWorkspace(repo: TrakRepository, path: string) {
//     try {
//         // Construct working path
//         const workingPath = join(repo.workTree, path);
//         // Skip if file does not exist
//         if (!FileSystem.exists(workingPath))
//             throw new Error('File does not exist');
//         // Remove file and all empty parent directories
//         await FileSystem.removeFile(workingPath, repo.workTree);
//         // Update Index
//         TIndex.removeEntry(path);
//     } catch (error) {
//         throw new Error(`Error deleting from workspace: ${error}`);
//     }
// }

// /**
//  * 
//  * 
//  * @param path 
//  * @param oid 
//  * @param mode 
//  */
// async function addToWorkingDirectory(repo: TrakRepository, path: string, oid: string, mode: string) {
//     try {
//         const dirPath = join(repo.workTree, dirname(path));
//         if (!FileSystem.exists(dirPath)) {
//             await mkdir(dirPath, { recursive: true });
//         }

//         if (mode === UnixFileModeEnum.DIR) {
//             await mkdir(path);
//         } else {
//             await updateFile(repo, path, oid, mode);
//         }
//     } catch (error) {
//         throw new Error(`Error Adding to Workspace: ${error}`);
//     }
// }

// /**
//  * Load new content from object database
//  * 
//  * @param path 
//  * @param oid 
//  * @param mode 
//  */
// async function updateFile(repo: TrakRepository, path: string, oid: string, mode: string) {
//     try {
//         console.log(`+>>>>>Updating file: ${ path }`);
//         const blob = await TObjects.readObject(repo, oid);
//         await FileSystem.writeFile(join(repo.workTree, path), blob!.content);
//         //FileSystem.setMode(path, mode);
//         // Update index
//         TIndex.addEntry(path, oid);
//     } catch (error) {
//         throw new Error(`Error updating file: ${error}`);
//     }
// }


// /**
//  * Sort by path depth (number of "/" in path)
//  * Ascending: shallow first (for creating dirs before files)
//  * Descending: deep first (for deleting files before dirs)
//  * 
//  * 
//  * @param actions 
//  * @param descendingOrder 
//  */
// export function sortByDepth(actions: DiffEntry[], descendingOrder: boolean = false) {
//     return actions.map(action => action).sort((a, b) => {
//         const depthA = (a.path.match(/\//g) || []).length;
//         const depthB = (b.path.match(/\//g) || []).length;

//         if (descendingOrder) {
//             return depthA - depthB;
//         } else {
//             return depthB - depthA;
//         }
//     })
// }