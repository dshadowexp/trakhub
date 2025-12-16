import { join } from "path";
import { TrakRepository } from "../repository";
import { TIndex } from "../repo/t-index";
import { FileSystem } from "../lib/standard";
import { TObjects, TTree } from "../repo/objects";
import { UnixFileModeEnum, type DirTree, type TrakTreeEntry } from "../types";

export async function writeTree(repo?: TrakRepository | null): Promise<string | null> {
    if (!repo)
        repo = await TrakRepository.repoFind();
        if (!repo)
            return null;

    return await _buildTreeFromIndex(repo);
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
async function _buildTreeFromIndex(repo: TrakRepository): Promise<string> {
    // Organize files by directory
    const rootDirTree = _organizeIntoHierarchy();
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
 * @returns { DirTree }
 */
function _organizeIntoHierarchy(): DirTree {
    // Initialize files and directory maps
    const files: Record<string, string> = {};
    const dirs: Record<string, DirTree> = {};

    for (const { path, sha1 } of TIndex.entries) {
        // Split path into directories
        const parts = path.split('/');
        if (parts.length === 1) {
            // Assign blob hash if file
            files[path] = sha1.toString("hex");
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
            current[parts[parts.length - 1]] = sha1.toString("hex");
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
            // Add directly to tree entry
            treeEntries.push({ 
                mode: FileSystem.mode(path), 
                name, 
                oid: content 
            });
        } else if (typeof content === 'object') {
            // Its a subdirectory - recursivley build subtree first
            const subtreeHash = await _buildTreeRecursive(repo, content, path);
            // Collect tree entry
            treeEntries.push({ mode: UnixFileModeEnum.DIR, name, oid: subtreeHash });
        }
    }

    // Initialize a new Tree
    const tree = new TTree(treeEntries);
    // Write and return tree hash
    return await TObjects.writeObject(tree, repo);
}
