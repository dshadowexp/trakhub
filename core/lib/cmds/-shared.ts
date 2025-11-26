import { join } from "path";
import type { TrakTreeEntry } from "../types";
import { TrakRepository } from "../repository";
import { TrakCommit, TrakTree, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs";


// ************************************************************************************************/
// Helper functions

/**
 * 
 * @param repo 
 * @param branchName 
 * @returns 
 */
export async function getBranchCommitFiles(repo: TrakRepository, branchName: string): Promise<TrakTreeEntry[]> {
    try {
        const commitHash = await TrakRefs.getBranchCommit(repo, branchName);
        if (!commitHash)
            return [];

        const commitObject = (await TrakObjectsBase.readObject(repo, commitHash)) as TrakCommit;
        return await _extractFilesFromTree(repo, commitObject.treeHash);
    } catch (error) {
        return [];
    }
}

/**
 * 
 * @param repo 
 * @param treeHash 
 * @param prefix 
 * @returns 
 */
async function _extractFilesFromTree(repo: TrakRepository, treeHash: string, prefix: string = ""): Promise<TrakTreeEntry[]> {
    let files: TrakTreeEntry[] = [];

    try {
        const treeObject = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;

        for (const { mode, name, oid } of treeObject.entries) {
            // Compute relative file path
            const fullPath = join(prefix, name);

            if (mode.startsWith("100")) {
                files.push({ name: fullPath, oid, mode });
            } else if (mode.startsWith("040")) {
                // Recurse into directories
                const subTreeFiles = await _extractFilesFromTree(repo, oid, fullPath);
                // Merge files and sub directory files
                files = [...files, ...subTreeFiles];
            }
        }
    } catch (error) {
        process.stdout.write(`Warning: Could not read tree ${treeHash}: ${error}`);
    }

    return files;
}

/**
 * 
 * @param repo 
 * @param ancestorSha 
 * @param descendantSha 
 * @returns 
 */
export async function isAncestor(repo: TrakRepository, ancestorSha: string, descendantSha: string): Promise<boolean> {
    const visited = new Set<string>();
    const queue: string[] = [descendantSha];

    while (queue.length > 0) {
        const currentSha = queue.shift()!;

        if (currentSha === ancestorSha) {
            return true;
        }

        if (visited.has(currentSha)) {
            continue;
        }

        visited.add(currentSha);

        // Load the commit object
        const commit = (await TrakObjectsBase.readObject(
            repo,
            currentSha
        )) as TrakCommit;

        // commit._parentHashes is an array of parent SHAs
        if (commit.parentHashes && commit.parentHashes.length > 0) {
            for (const parent of commit.parentHashes) {
                queue.push(parent);
            }
        }
    }

    return false;
}


