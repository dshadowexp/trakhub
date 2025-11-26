import { resolve, relative, join } from "path";
import { TrakFileSystem } from "../file-system";
import { TrakBlob, TrakObjectsBase } from "../db/objects";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";

export async function add(path: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Resolve path argument
    const fullPath = resolve(path);
    // Ensure path exists
    if (!TrakFileSystem.exists(fullPath))
        throw new Error(`Path ${fullPath} not found`);

    if (TrakFileSystem.isFile(fullPath)) {
        // Add file to object
        await _addFile(fullPath, repo);
    } else if (TrakFileSystem.isDirectory(fullPath)) {
        // Add directory
        await _addDirectory(fullPath, repo);
    } else {
        throw new Error(`${fullPath} is neither a file nor directory`);
    }
}

/**
 * 
 * @param filePath 
 * @param repo 
 */
async function _addFile(filePath: string, repo: TrakRepository) {
    // Read the file content
    const fileData = await TrakFileSystem.readFile(filePath);
    // Create and Store blob object in database
    const blobHash = await TrakObjectsBase.writeObject(new TrakBlob(fileData), repo);
    // Load index file json contents
    const indexJSON = await TrakIndex.loadIndex(repo);
    // Map blob hash to file path: [path] -> hash
    indexJSON[relative(repo.workTree, filePath)] = blobHash;
    // Save map to index file
    await TrakIndex.saveIndex(repo, indexJSON);
}

/**
 * 
 * @param dirPath 
 * @param repo 
 */
async function _addDirectory(dirPath: string, repo: TrakRepository) {
    // Load index file json contents
    const indexJSON = await TrakIndex.loadIndex(repo);
    const stack: string[] = [dirPath];

    while (stack.length > 0) {
        // Get current directory from stack
        const currentDir = stack.pop()!;
        // Read entries from directory
        const entries = await TrakFileSystem.readDirectory(currentDir) as string[];

        // Populate stack and process file entries
        for (const entry of entries) {
            // Resolve full path for directory entry
            const fullPath = join(currentDir, entry);

            if (TrakFileSystem.isDirectory(fullPath)) {
                // Push to stack if path is a directory
                stack.push(fullPath);
            } else {
                // Read the file content
                const fileData = await TrakFileSystem.readFile(fullPath);
                // Create and store blob object from content
                const blobHash = await TrakObjectsBase.writeObject(new TrakBlob(fileData), repo);
                // Update index map of blob hash to file path: [path] -> indexEntry
                indexJSON[relative(repo.workTree, fullPath)] = blobHash;
            }
        }
    }

    // Save map of files to index file
    await TrakIndex.saveIndex(repo, indexJSON);
}