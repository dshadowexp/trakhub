import { join } from "path";
import { TrakCommit, TrakObjectsBase, TrakTree } from "../db/objects";
import { TrakRepository } from "../repository";
import { UnixFileModeEnum, type TrakTreeEntry } from "../types";

export enum DiffAction {
    ADD = "add",
    DELETE = "delete",
    MODIFY = "modify"
}

export type DiffEntry = {
    action: DiffAction
    path: string
    oldOid?: string
    newOid?: string
    oldMode?: string
    newMode?: string
}

/**
 * 
 * @param repo 
 * @param sourceCommitHash 
 * @param targetCommitHash 
 * @returns 
 */
export async function treeDiff(repo: TrakRepository, sourceCommitHash: string, targetCommitHash: string) {
     const commitObjectA = (await TrakObjectsBase.readObject(repo, sourceCommitHash)) as TrakCommit;
     const commitObjectB = (await TrakObjectsBase.readObject(repo, targetCommitHash)) as TrakCommit;
     return await compareTrees(repo, commitObjectA.treeHash, commitObjectB.treeHash);
}

/**
 * 
 * 
 * @param treeHashA - SHA1 hash of tree object a
 * @param treeHashB - SHA1 Hash of tree object b
 * @param prefix - current path prefix for nested trees
 */
async function compareTrees(repo: TrakRepository, treeHashA: string | null, treeHashB: string | null, prefix: string = ""): Promise<DiffEntry[]> {
    let changes: DiffEntry[] = [];
    const treeAEntries = !treeHashA ? [] : ((await TrakObjectsBase.readObject(repo, treeHashA)) as TrakTree).entries;
    const treeBEntries = !treeHashB ? [] : ((await TrakObjectsBase.readObject(repo, treeHashB)) as TrakTree).entries;

    let indexA = 0, indexB = 0;
    let entryA: TrakTreeEntry, entryB: TrakTreeEntry;

    while (indexA < treeAEntries.length || indexB < treeBEntries.length) {
        if (indexA >= treeAEntries.length) {
            entryB = treeBEntries[indexB];
            changes.push(...(await detectedAddition(repo, entryB, prefix)));
            indexB++;
        } else if (indexB >= treeBEntries.length) {
            entryA = treeAEntries[indexA];
            changes.push(...(await detectedDeletion(repo, entryA, prefix)));
            indexA++;
        } else {
            entryA = treeAEntries[indexA];
            entryB = treeBEntries[indexB];

            const comparison = comparePaths(entryA, entryB);
            if (comparison < 0) {
                changes.push(...(await detectedDeletion(repo, entryA, prefix)));
                indexA++;
            } else if (comparison > 0) {
                changes.push(...(await detectedAddition(repo, entryB, prefix)));
                indexB++;
            } else {
                changes.push(...(await detectedChange(repo, entryA, entryB, prefix)));
                indexA++;
                indexB++;
            }
        }
    }

    return changes;
}

/**
 * 
 * @param repo 
 * @param entry 
 * @param prefix 
 * @returns 
 */
async function detectedAddition(repo: TrakRepository, entry: TrakTreeEntry, prefix: string): Promise<DiffEntry[]> {
    const fullPath = join(prefix, entry.name);

    if (entry.mode === UnixFileModeEnum.DIR) {
        // It's a tree (directory) - recurse to show all added files
        return await compareTrees(repo, null, entry.oid, fullPath);
    } else {
        // It's a blob (file)
        return [{ action: DiffAction.ADD, path: fullPath, newOid: entry.oid, newMode: entry.mode }];
    }
}

/**
 * 
 * @param repo 
 * @param entry 
 * @param prefix 
 * @returns 
 */
async function detectedDeletion(repo: TrakRepository, entry: TrakTreeEntry, prefix: string): Promise<DiffEntry[]> {
    const fullPath = join(prefix, entry.name);

    if (entry.mode === UnixFileModeEnum.DIR) {
        // It's a tree (directory) - recurse to show all deleted files
        return await compareTrees(repo, entry.oid, null, fullPath);
    } else {
        // It's a blob (file)
        return [{ action: DiffAction.DELETE, path: fullPath, oldOid: entry.oid, oldMode: entry.mode }];
    }
}

/**
 * 
 * @param repo 
 * @param entryA 
 * @param entryB 
 * @param prefix 
 * @returns 
 */
async function detectedChange(repo: TrakRepository, entryA: TrakTreeEntry, entryB: TrakTreeEntry, prefix: string): Promise<DiffEntry[]> {
    const fullPath = join(prefix, entryA.name);
    // Check if modes are different (type changed)
    if (entryA.oid !== entryB.oid) {
        if ((entryA.mode === UnixFileModeEnum.DIR) || (entryB.mode === UnixFileModeEnum.DIR)) {
            // Type changed between file and directory
            let changes: DiffEntry[] = [];
            if (entryA.mode === UnixFileModeEnum.DIR) {
                changes.push(...(await detectedDeletion(repo, entryA, prefix)));
            } else {
                return [{ action: DiffAction.DELETE, path: fullPath, oldOid: entryA.oid, oldMode: entryA.mode }];
            }

            if (entryB.mode === UnixFileModeEnum.DIR) {
                changes.push(...(await detectedAddition(repo, entryB, prefix)));
            } else {
                return [{ action: DiffAction.ADD, path: fullPath, newOid: entryB.oid, newMode: entryB.mode }];
            }

            return changes;
        } else {
            // Both are blobs - content changed
            return [{ action: DiffAction.MODIFY, path: fullPath, oldOid: entryA.oid, newOid: entryB.oid, oldMode: entryA.mode, newMode: entryB.mode }];
        }
    }

    // Same mode - check OID
    if (entryA.oid === entryB.oid) {
        // Identical - no change
        return [];
    }

    // Different OIDs
    if ((entryA.mode === UnixFileModeEnum.DIR) && (entryB.mode === UnixFileModeEnum.DIR)) {
        // Both are trees - recurse into subdirectory
        return await compareTrees(repo, entryA.oid, entryB.oid, fullPath);
    } else {
        // Both are blobs - content changed
        return [{ action: DiffAction.MODIFY, path: fullPath, oldOid: entryA.oid, newOid: entryB.oid, oldMode: entryA.mode, newMode: entryB.mode }];
    }
}

/**
 * 
 * @param entryA 
 * @param entryB 
 * @returns 
 */
function comparePaths(entryA: TrakTreeEntry, entryB: TrakTreeEntry): number {
    // Git sorts tree entries with special rules:
    // Directories are treated as having "/" appended for sorting
    const sortNameA = entryA.name + (entryA.mode === UnixFileModeEnum.DIR ? '/' : '');
    const sortNameB = entryB.name + (entryB.mode === UnixFileModeEnum.DIR ? '/' : '');

    if (sortNameA < sortNameB) return -1;
    if (sortNameA > sortNameB) return 1;
    return 0;
}

// const repo = await TrakRepository.repoFind();
// if (repo) {
//     const ans = await treeDiff(repo, '1ac2f1653d724aacbac3ee46f0c872734ff2e8db', 'fa1f925359798dd13b3401faf50ef641cb9a448a');
//     console.log(ans);
// }
