import { dirname, join } from "path";
import { DiffAction, type DiffEntry } from "./tree-diff";
import { FileSystem } from "./standard";
import { TrakBlob, TrakObjectsBase } from "../db/objects";
import type { TrakRepository } from "../repository";
import { UnixFileModeEnum } from "../types";
import { mkdir } from "fs/promises";

//handle migrations
export async function migration(repo: TrakRepository, treeDiffChanges: DiffEntry[]) {
    // Get working directory
    const workingDirectory = repo.workTree;

    // Group changes by type for processing order
    const deletions: DiffEntry[] = [];
    const modifications: DiffEntry[] = [];
    const additions: DiffEntry[] = [];

    for (const diffEntry of treeDiffChanges) {
        switch (diffEntry.action) {
            case 'delete':
                deletions.push(diffEntry);
                break;
            case 'modify':
                modifications.push(diffEntry);
                break;
            case 'add':
                additions.push(diffEntry);
                break;
        }
    }

    // Process in order: delete, modify, add
    // This prevents conflicts (e.g. can't add the same file if  file exists)

    // Step 1: Delete Files (in reverse depth order - files before dirs)
    const sortDeletions = sortByDepth(deletions, true);
    for (const diffEntry of sortDeletions) {
        await deleteFromWorkspace(join(workingDirectory, diffEntry.path), workingDirectory);
    }

    // Step 2: Modify Files 
    for (const diffEntry of modifications) {
        await updateFile(repo, join(workingDirectory, diffEntry.path), diffEntry.newOid!, diffEntry.newMode!);
    }

    // Step 3: Add files (in depth order - dirs before files)
    const sortAdditions = sortByDepth(additions, false);
    for (const diffEntry of sortAdditions) {
        await addToWorkingDirectory(repo, join(workingDirectory, diffEntry.path), diffEntry.newOid!, diffEntry.newMode!);
    }
}

async function detectConflicts(repo: TrakRepository, changes: DiffEntry[], workingDirectory: string) {
    const conflicts: string[] = [];

    for (const change of changes) {
        const fullPath = join(workingDirectory, change.path);

        switch(change.action) {
            case DiffAction.ADD:
                if (FileSystem.exists(fullPath)) {
                    conflicts.push(fullPath);
                }
                break;
            case DiffAction.DELETE:
                if (!FileSystem.exists(fullPath)) {
                    conflicts.push(fullPath);
                }
                break;
            case DiffAction.MODIFY:
                if (FileSystem.exists(fullPath)) {
                    const fileData = await FileSystem.readFile(fullPath);
                    const blob = new TrakBlob(fileData);
                    if (blob.hash() !== change.newOid) {
                        conflicts.push(fullPath);
                    }
                } else {
                    conflicts.push(fullPath);
                }
                break;
        }
    }

    return conflicts;
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
            return depthB - depthA;
        } else {
            return depthA - depthB;
        }
    })
}