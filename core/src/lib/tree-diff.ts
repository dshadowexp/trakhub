import { join } from "path";
import { TCommit, TObjects, TTree } from "../repo/objects";
import { DiffAction, UnixFileModeEnum, type TrakTreeEntry } from "../types";
import type { TRepository } from "../repo/repository";

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
export async function treeDiff(repo: TRepository, sourceCommitHash: string, targetCommitHash: string) {
     const commitObjectA = await repo.objects.loadCommit(sourceCommitHash);
     const commitObjectB = await repo.objects.loadCommit(targetCommitHash);
     return await compareTrees(repo, commitObjectA.treeHash, commitObjectB.treeHash);
}

/**
 * 
 * 
 * @param treeHashA - SHA1 hash of tree object a
 * @param treeHashB - SHA1 Hash of tree object b
 * @param prefix - current path prefix for nested trees
 */
async function compareTrees(repo: TRepository, treeHashA: string | null, treeHashB: string | null, prefix: string = ""): Promise<DiffEntry[]> {
    let changes: DiffEntry[] = [];
    const treeAEntries = !treeHashA ? [] : (await repo.objects.loadTree(treeHashA)).entries;
    const treeBEntries = !treeHashB ? [] : (await repo.objects.loadTree(treeHashB)).entries;

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



// const repo = await TrakRepository.repoFind();
// if (repo) {
//     const ans = await treeDiff(repo, '1ac2f1653d724aacbac3ee46f0c872734ff2e8db', 'fa1f925359798dd13b3401faf50ef641cb9a448a');
//     console.log(ans);
// }
