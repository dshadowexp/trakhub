import { join } from "path";
import { TrakCommit, TrakObjectsBase, TrakTree } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import type { DirTree, TrakAuthor, TrakTreeEntry } from "../types";
import { DIRECTORY_MODE, EXECUTABLE_FILE_MODE, REGULAR_FILE_MODE, SYMBOLIC_LINK } from "../constants";
import { TrakFileSystem } from "../file-system";


export async function commit(message: string, author: TrakAuthor, committer: TrakAuthor) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Read the index (staging area)
    const indexContent = await TrakIndex.loadIndex(repo);
    if (Object.keys(indexContent).length === 0) {
        process.stdout.write('Nothing to commit, working tree clean - first\n');
        return null;
    }

    // Build tree objects from index
    const treeHash = await _buildTreeFromIndex(repo, indexContent);

    // Get current branch
    const currentBranchName = await TrakRefs.getCurrentBranch(repo);
    // Get parent commit
    const parentCommit = await TrakRefs.getBranchCommit(repo, currentBranchName);
    // Verify no changes from computed hashes
    if (parentCommit) {
        const parentCommitObject = (await TrakObjectsBase.readObject(repo, parentCommit)) as TrakCommit;

        if (parentCommitObject.treeHash === treeHash) {
            process.stdout.write('Nothing to commit, working tree clean - second\n');
            return null;
        }
    }

    // Create commit object
    const parentHashes = parentCommit !== undefined ? [ parentCommit ] : [];
    const commit = new TrakCommit(treeHash, parentHashes, author, committer, message);
    const commitHash = await TrakObjectsBase.writeObject(commit, repo);;

    // Update references - commit of current branch
    await TrakRefs.setBranchCommit(repo, currentBranchName, commitHash);

    const commitPointer = parentHashes.length > 0 ? currentBranchName : currentBranchName;
    process.stdout.write(`[${ commitPointer } ${ commitHash }] ${ message }\n`);
    return commitHash;
}

/**
 * Index is flat: ["README.md", "src/main.py", "src/utils.py"]
 * Need to create tree hierarchy:
 *   root_tree
 *   ├── README.md (blob)
 *   └── src (tree)
 *       ├── main.py (blob)
 *       └── utils.py (blob)
 * 
 * @param repo { TrakRepository }
 * @param indexEntries  { Record<string, string> }
 * @returns 
 */
async function _buildTreeFromIndex(repo: TrakRepository, indexEntries: Record<string, string>): Promise<string> {
    // Organize files by directory
    const rootDirTree = _organizeIntoHierarchy(indexEntries);
    // Build trees recursively from bottom up
    return await _buildTreeRecursive(repo, rootDirTree);
}

/**
 * 
 * # Convert flat list to nested structure
 * ["src/main.py", "src/utils.py", "README.md"]
 * becomes:
 * {
 * "README.md": "abc...",
 * "src": {
 *      "main.py": "def...",
 *      "utils.py": "ghi..."
 *    }
 *  }
 * 
 * @param indexEntries { Record<string, string> }
 * @returns { DirTree }
 */
function _organizeIntoHierarchy(indexEntries: Record<string, string>): DirTree {
    // Initialize files and directory maps
    const files: Record<string, string> = {};
    const dirs: Record<string, DirTree> = {};

    for (const [filePath, blobHash] of Object.entries(indexEntries)) {
        // Split path into directories
        const parts = filePath.split('/');
        if (parts.length === 1) {
            // Assign blob hash if file
            files[filePath] = blobHash;
        } else {
            // Create trie like object if 
            const dirName = parts[0];
            // Create new directory tree if new root direcotry
            if (!(dirName in dirs))
                dirs[dirName] = {}

            let current = dirs[dirName];
            // Create tree maps for all directories between
            for (const part of parts.slice(1, -1)) {
                // Create new directory tree if new direcotry
                if (!(part in current))
                    current[part] = {}

                current = current[part] as DirTree;
            }

            // Assign blob hash to last path(file) in tree
            current[parts[parts.length - 1]] = blobHash
        }
    }

    // Organize into single root file
    const root: DirTree = { ...files };
    for (const [dirName, dirContents] of Object.entries(dirs)) {
        root[dirName] = dirContents;
    }

    return root;
}

/**
 * 
 * @param repo 
 * @param dirTree 
 * @param prefix 
 * @returns 
 */
async function _buildTreeRecursive(repo: TrakRepository, dirTree: DirTree, prefix: string = ""): Promise<string> {
    // Initialize list to collect tree entries
    const treeEntries: TrakTreeEntry[] = [];
    
    for (const [name, content] of Object.entries(dirTree)) {
        // Compute part
        const path = join(prefix, name);

        if (typeof content === 'string') {
            // It's a blob - Get stats of file
            const stats = TrakFileSystem.stats(path);
            // Add directly to tree entry
            treeEntries.push({ 
                mode: stats.isSymbolicLink() ? SYMBOLIC_LINK : (stats.mode & 0o111) !== 0 ? EXECUTABLE_FILE_MODE : REGULAR_FILE_MODE, 
                name, 
                oid: content 
            });
        } else if (typeof content === 'object') {
            // Its a subdirectory - recursivley build subtree first
            const subtreeHash = await _buildTreeRecursive(repo, content, path);
            // Collect tree entry
            treeEntries.push({ mode: DIRECTORY_MODE, name, oid: subtreeHash });
        }
    }

    // Initialize a new Tree
    const tree = new TrakTree(treeEntries);
    // Write and return tree hash
    return await TrakObjectsBase.writeObject(tree, repo);
}
