import { dirname, join } from "path";
import type { TrakTreeEntry } from "../types";
import { TrakRepository } from "../repository";
import { TrakCommit, TrakTree, TrakObjectsBase, TrakBlob } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { asyncFilter, difference, intersection } from "../util";
import { TrakFileSystem } from "../file-system";
import { TrakIndex } from "../db/t-index";
import { mkdir } from "fs/promises";

// ************************************************************************************************/
// Helper functions

/**
 * 
 * Check if working directory or index differs from HEAD
 * 
 * @param repo 
 * @param treeEntries 
 * @returns 
 */
export async function hasUncommittedChanges(repo: TrakRepository): Promise<boolean> {
    // Load HEAD commit
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    const currentTree = await getBranchCommitFiles(repo, currentBranch);
    const committedFiles: Record<string, TrakTreeEntry> = currentTree.reduce((current, value) => {
        return { ...current, [value.name]: value }
    }, {});

    // Load index (Staging area)
    const indexEntries = await TrakIndex.loadIndex(repo);

    // COMPARE HEAD vs INDEX (staged changes)
    const [stagedNew, stagedModified, stagedDeleted] = await getStatus(Object.keys(indexEntries), Object.keys(committedFiles), async (path) => indexEntries[path], async (path) => committedFiles[path].oid);

    // COMPARE INDEX vs WORKING DIRECTORY (unstaged changes)
    const [untracked, unstagedModified, unstagedDeleted] = await getStatus(Object.keys(indexEntries), Object.keys(indexEntries), async (path) => indexEntries[path], async (path) => {
        const fileData = await TrakFileSystem.readFile(path);
        const blob = new TrakBlob(fileData);
        return blob.hash();
    });

    if (unstagedModified.length > 0)
        return true;

    if (stagedNew.length > 0)
        return true;

    if (stagedModified.length > 0)
        return true;

    return false;
}

/**
 * 
 * @param filesA 
 * @param filesB 
 * @param getFileAOid 
 * @param getFileBOid 
 * @returns 
 */
export async function getStatus(filesA: string[], filesB: string[], getFileAOid: (path: string) => Promise<string>, getFileBOid: (path: string) => Promise<string>): Promise<[string[], string[], string[]]> {
    const added = difference<string>(filesA, filesB);
    const modified = await asyncFilter<string>(intersection<string>(filesA, filesB), async (path) => { 
        const a = await getFileAOid(path);
        const b = await getFileBOid(path);
        return a != b;
    });
    const deleted = difference<string>(filesB, filesA);
    
    return [added, modified, deleted];
}

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
        return await extractFilesFromTree(repo, commitObject.treeHash);
    } catch (error) {
        return [];
    }
}

/**
 * 
 * @param repo 
 * @param filesToClear 
 */
export async function updateWorkingDirectory(repo: TrakRepository, currentTree: TrakTreeEntry[], targetTree: TrakTreeEntry[]) {
    const filesToClear = difference<string>(currentTree.map((file) => file.name), targetTree.map((file) => file.name));

    for (const relativePath of filesToClear.sort()) {
        // Compute file path
        const fullPath = join(repo.workTree, relativePath);

        try {
            // Skip if file does not exist
            if (!TrakFileSystem.exists(fullPath))
                continue;
            // Remove file and all empty parent directories
            await TrakFileSystem.removeFile(fullPath, repo.workTree);
        } catch (error) {}
    }

    // Restore Entries
    // Add or update files that exist in target branch
    for (const { mode, name, oid } of targetTree) {
        // Compute file path
        const fullPath = join(repo.workTree, name);
        // Create directory for file
        const dirPath = dirname(fullPath);
        await mkdir(dirPath, { recursive: true });
        // Read blob object from blob sha hash
        const blobObject = (await TrakObjectsBase.readObject(repo, oid)) as TrakBlob;
        const blob = TrakBlob.deserialize(blobObject.content);
        // Write blob content to file
        await TrakFileSystem.writeFile(fullPath, blob.content);
    }
}

/**
 * 
 * @param repo 
 * @param tree 
 */
export async function updateIndexFromTree(repo: TrakRepository, tree: TrakTreeEntry[]) {
    await TrakIndex.clearIndex(repo);
    await TrakIndex.saveIndex(repo, tree.reduce((current, record) => {
        return { ...current, [record.name]: record.oid };
    }, {}));
}

/**
 * 
 * @param repo 
 * @param treeHash 
 * @param prefix 
 * @returns 
 */
export async function extractFilesFromTree(repo: TrakRepository, treeHash: string, prefix: string = ""): Promise<TrakTreeEntry[]> {
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
                const subTreeFiles = await extractFilesFromTree(repo, oid, fullPath);
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
        const commit = (await TrakObjectsBase.readObject(repo, currentSha)) as TrakCommit;

        // commit._parentHashes is an array of parent SHAs
        if (commit.parentHashes && commit.parentHashes.length > 0) {
            for (const parent of commit.parentHashes) {
                queue.push(parent);
            }
        }
    }

    return false;
}


