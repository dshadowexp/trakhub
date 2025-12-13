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
    await applyChanges(repo, changes);
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
    return blob.hash() !== expectedOid;
}

/**
 * 
 * @param repo 
 * @param treeDiffChanges 
 * @param workingDirectory 
 */
async function applyChanges(repo: TrakRepository, treeDiffChanges: DiffEntry[]) {
    // Group changes by type for processing order
    const deletions: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.DELETE);
    const modifications: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.MODIFY);
    const additions: DiffEntry[] = treeDiffChanges.filter((change) => change.action === DiffAction.ADD);

    // Process in order: delete, modify, add
    // This prevents conflicts (e.g. can't add the same file if file exists)

    // Step 1: Delete Files (in reverse depth order - files before dirs)
    const sortDeletions = sortByDepth(deletions, true);
    for (const diffEntry of sortDeletions) {
        await deleteFromWorkspace(repo, diffEntry.path);
    }

    // Step 2: Modify Files 
    for (const diffEntry of modifications) {
        await updateFile(repo, diffEntry.path, diffEntry.newOid!, diffEntry.newMode!);
    }

    // Step 3: Add files (in depth order - dirs before files)
    const sortAdditions = sortByDepth(additions, false);
    for (const diffEntry of sortAdditions) {
        await addToWorkingDirectory(repo, diffEntry.path, diffEntry.newOid!, diffEntry.newMode!);
    }
}

/**
 * 
 * @param path 
 * @param workingDirectory 
 */
async function deleteFromWorkspace(repo: TrakRepository, path: string) {
    try {
        // Construct working path
        const workingPath = join(repo.workTree, path);
        // Skip if file does not exist
        if (!FileSystem.exists(workingPath))
            throw new Error('File does not exist');
        // Remove file and all empty parent directories
        await FileSystem.removeFile(workingPath, repo.workTree);
        // Update Index
        TrakIndex.removeEntry(path);
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
        const dirPath = join(repo.workTree, dirname(path));
        if (!FileSystem.exists(dirPath)) {
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
        console.log(`+>>>>>Updating file: ${ path }`);
        const blob = await TrakObjectsBase.readObject(repo, oid);
        await FileSystem.writeFile(join(repo.workTree, path), blob!.content);
        //FileSystem.setMode(path, mode);
        // Update index
        TrakIndex.addEntry(path, oid);
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