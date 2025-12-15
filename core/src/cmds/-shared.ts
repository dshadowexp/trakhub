import { dirname, join, resolve } from "path";
import { mkdir } from "fs/promises";
import { type TrakTreeEntry } from "../types";
import { TrakRepository } from "../repository";
import { TrakCommit, TrakTree, TrakObjectsBase, TrakBlob } from "../db/objects";
import { difference } from "../util";
import { FileSystem, Terminal } from "../lib/standard";
import { compareHeadAgainstIndex, compareWorkingDirectoryAgainstIndex } from "./status";

// ************************************************************************************************/
// Defintions



// ************************************************************************************************/
// Helper functions


/**
 * Check if working directory or index differs from HEAD
 * Ensure index (staging area) is loaded
 * 
 * @param repo 
 * @param treeEntries 
 * @returns 
 */
export async function hasUncommittedChanges(repo: TrakRepository): Promise<boolean> {
    // COMPARE HEAD vs INDEX (staged changes)
    const [stagedNew, stagedModified, stagedDeleted] = await compareHeadAgainstIndex(repo);

    // COMPARE INDEX vs WORKING DIRECTORY (unstaged changes)
    const [untracked, unstagedModified, unstagedDeleted] = await compareWorkingDirectoryAgainstIndex(repo);

    return (unstagedModified.length > 0 || stagedNew.length > 0 || stagedModified.length > 0);
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
            if (!FileSystem.exists(fullPath))
                continue;
            // Remove file and all empty parent directories
            await FileSystem.removeFile(fullPath, repo.workTree);
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
        await FileSystem.writeFile(fullPath, blob.content);
    }
}

/**
 * 
 * @param repo 
 * @param branchName 
 * @returns 
 */
export async function getTreeFilesFromCommit(repo: TrakRepository, commitHash: string): Promise<TrakTreeEntry[]> {
    try {
        const commitObject = (await TrakObjectsBase.readObject(repo, commitHash)) as TrakCommit;
        return await extractFilesFromTree(repo, commitObject.treeHash);
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

        Terminal.println(`Warning: Could not read tree ${treeHash}: ${error}`);
    }

    return files;
}

/**
 * 
 * @param paths 
 * @param workTree 
 * @returns 
 */
export function makePathsAbsolute(paths: string[], workTree: string): Set<string> {
    // Make paths absolute
    const absolutePaths = new Set<string>();
    for (const path of paths) {
        // Resolve path argument
        const absolutePath = resolve(path);
        if (absolutePath.startsWith(workTree)) {
            absolutePaths.add(absolutePath);
        } else {
            throw new Error(`Cannot remove paths outside of worktree: ${ path }`);
        }
    }

    return absolutePaths;
}