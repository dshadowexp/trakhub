import { dirname, join } from "path";
import { DiffAction, type DiffEntry } from "./tree-diff";
import { FileSystem, Terminal } from "./standard";
import { TrakBlob, TrakObjectsBase } from "../db/objects";
import type { TrakRepository } from "../repository";
import { UnixFileModeEnum } from "../types";
import { mkdir } from "fs/promises";
import { TrakIndex } from "../db/t-index";

export async function migrate(repo: TrakRepository, changes: DiffEntry[]) {
    // Step 1: Check for conflicts
    const conflicts = await detectConflicts(changes, repo.workTree);
    if (conflicts.length > 0) {
        conflicts.forEach((conflict) => Terminal.println(conflict));
        throw new Error('Has conflicts');
    }

    // apply changes to directory
    await applyChanges(repo, changes, repo.workTree);
}

/**
 * 
 * @param repo 
 * @param tree 
 */
// export async function updateIndexFromTree(repo: TrakRepository, tree: TrakTreeEntry[]) {
//     await TrakIndex.clearIndex(repo);
//     await TrakIndex.saveIndex(repo, tree.reduce((current, record) => {
//         return { ...current, [record.name]: record.oid };
//     }, {}));
// }

/**
 * 
 * @param repo 
 * @param treeDiffChanges 
 * @param workingDirectory 
 */
async function applyChanges(repo: TrakRepository, treeDiffChanges: DiffEntry[], workingDirectory: string) {
    // Group changes by type for processing order
    const deletions: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.DELETE);
    const modifications: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.MODIFY);
    const additions: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.ADD);

    // Process in order: delete, modify, add
    // This prevents conflicts (e.g. can't add the same file if file exists)

    // Step 1: Delete Files (in reverse depth order - files before dirs)
    const sortDeletions = sortByDepth(deletions, true);
    for (const diffEntry of sortDeletions) {
        const path = join(workingDirectory, diffEntry.path);
        await deleteFromWorkspace(path, workingDirectory);
        TrakIndex.remove(path)
    }

    // Step 2: Modify Files 
    for (const diffEntry of modifications) {
        const path = join(workingDirectory, diffEntry.path);
        await updateFile(repo, path, diffEntry.newOid!, diffEntry.newMode!);
        TrakIndex.add(path, diffEntry.newOid!);
    }

    // Step 3: Add files (in depth order - dirs before files)
    const sortAdditions = sortByDepth(additions, false);
    for (const diffEntry of sortAdditions) {
        const path = join(workingDirectory, diffEntry.path);
        await addToWorkingDirectory(repo, path, diffEntry.newOid!, diffEntry.newMode!);
        TrakIndex.add(path, diffEntry.newOid!);
    }
}

/**
 * 
 * @param changes 
 * @param workingDirectory 
 * @returns 
 */
async function detectConflicts(changes: DiffEntry[], workingDirectory: string) {
    const conflicts: string[] = [];

    for (const change of changes) {
        const fullPath = join(workingDirectory, change.path);

        switch(change.action) {
            case DiffAction.DELETE:
                if (!FileSystem.exists(fullPath)) {
                    conflicts.push(`Cannot delete non-existent: ${ fullPath }`);
                } else if (await isModified(fullPath, change.oldOid!)) {
                    conflicts.push(`File modified locally: ${fullPath}`);
                }
                break;
            case DiffAction.MODIFY:
                if (!FileSystem.exists(fullPath)) {
                    conflicts.push(`Cannot modify non-existent: ${ fullPath }`);
                } else if (await isModified(fullPath, change.oldOid!)) {
                    conflicts.push(`File modified locally: ${fullPath}`);
                }
                break;
            case DiffAction.ADD:
                if (FileSystem.exists(fullPath)) {
                    conflicts.push(`File already exists: ${ fullPath }`);
                }
                break;
        }
    }

    return conflicts;
}

/**
 * 
 * @param path 
 * @param expectedOid 
 * @returns 
 */
async function isModified(path: string, expectedOid: string) {
    const fileData = await FileSystem.readFile(path);
    const blob = new TrakBlob(fileData);
    return blob.hash() != expectedOid;
}

/**
 * 
 * @param path 
 * @param workingDirectory 
 */
async function deleteFromWorkspace(path: string, workingDirectory: string) {
    try {
        // Skip if file does not exist
        if (!FileSystem.exists(path))
            throw new Error('File does not exist');
        // Remove file and all empty parent directories
        await FileSystem.removeFile(path, workingDirectory);
    } catch (error) {
        throw new Error(`Error deleting from workspace: ${error}`);
    }
}

/**
 * 
 * 
 * @param path 
 * @param oid 
 * @param mode 
 */
async function addToWorkingDirectory(repo: TrakRepository, path: string, oid: string, mode: string) {
    try {
        const parentDir = dirname(path);
        const dirPath = join(repo.workTree, parentDir);
        if (FileSystem.exists(path)) {
            await mkdir(dirPath, { recursive: true });
        }

        if (mode === UnixFileModeEnum.DIR) {
            await mkdir(path);
        } else {
            await updateFile(repo, path, oid, mode);
        }
    } catch (error) {
        throw new Error(`Error Adding to Workspace: ${error}`);
    }
}

/**
 * Load new content from object database
 * 
 * @param path 
 * @param oid 
 * @param mode 
 */
async function updateFile(repo: TrakRepository, path: string, oid: string, mode: string) {
    try {
        const blob = await TrakObjectsBase.readObject(repo, oid);
        await FileSystem.writeFile(path, blob!.content);
        FileSystem.setPermssions(path, mode);
    } catch (error) {
        throw new Error(`Error updating file: ${error}`);
    }
}


/**
 * Sort by path depth (number of "/" in path)
 * Ascending: shallow first (for creating dirs before files)
 * Descending: deep first (for deleting files before dirs)
 * 
 * 
 * @param actions 
 * @param descendingOrder 
 */
export function sortByDepth(actions: DiffEntry[], descendingOrder: boolean = false) {
    return actions.map(action => action).sort((a, b) => {
        const depthA = (a.path.match(/\//g) || []).length;
        const depthB = (b.path.match(/\//g) || []).length;

        if (descendingOrder) {
            return depthA - depthB;
        } else {
            return depthB - depthA;
        }
    })
}