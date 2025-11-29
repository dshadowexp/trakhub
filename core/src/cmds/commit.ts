import { join } from "path";
import { TrakCommit, TrakObjectsBase, TrakTree } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import { TrakAuthor, UnixFileModeEnum, type DirTree, type TrakIndexRecord, type TrakTreeEntry } from "../types";
import { FileSystem, Terminal } from "../lib/standard";

export async function commit(message: string, author: TrakAuthor, committer: TrakAuthor) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get current branch
    const currentBranchName = await TrakRefs.getCurrentBranch(repo);
    // Get parent commit
    const parentCommit = await TrakRefs.getBranchCommit(repo, currentBranchName);

    // Create commit object
    const parentHashes = !parentCommit ? [] : [ parentCommit ];

    // Write Commit to objects
    const commit = await writeCommit(repo, parentHashes, message);
    if (!commit)
        return;

    const commitPointer = parentHashes.length > 0 ? currentBranchName : currentBranchName;
    Terminal.println(`[${ commitPointer } ${ commit?.hash() }] ${ message }`);
}

/**
 * 
 * @param repo 
 * @param parents 
 * @param message 
 * @returns 
 */
export async function writeCommit(repo: TrakRepository, parents: string[], message: string): Promise<TrakCommit | null> {
    // Read the index (staging area)
    await TrakIndex.load(repo);
    const indexEntries = TrakIndex.entries;
    if (Object.keys(indexEntries).length === 0) {
        Terminal.println('Nothing to commit, working tree clean - first');
        return null;
    }

    // Build tree objects from index
    const treeHash = await _buildTreeFromIndex(repo, indexEntries);

    // Verify no changes from computed hashes
    if (parents.length > 0) {
        const parentCommitObject = (await TrakObjectsBase.readObject(repo, parents[0])) as TrakCommit;

        if (parentCommitObject.treeHash === treeHash) {
            Terminal.println('Nothing to commit, working tree clean - second');
            return null;
        }
    }

    // Construct author
    const name = "Random"; // load from config
    const email = "random@gmail.com"; // load from config
    const author = new TrakAuthor(name, email);
    const committer = new TrakAuthor(name, email);

    // Create commit object
    const commit = new TrakCommit(treeHash, parents, author, committer, message);
    const commitHash = await TrakObjectsBase.writeObject(commit, repo);;

    // Update references - commit of current branch
    await TrakRefs.setCurrentHeadCommit(repo, commitHash);

    return commit;
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
async function _buildTreeFromIndex(repo: TrakRepository, indexEntries: TrakIndexRecord): Promise<string> {
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
function _organizeIntoHierarchy(indexEntries: TrakIndexRecord): DirTree {
    // Initialize files and directory maps
    const files: Record<string, string> = {};
    const dirs: Record<string, DirTree> = {};

    for (const { path, sha1 } of Object.values(indexEntries)) {
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
            // It's a blob - Get stats of file
            const stats = FileSystem.stats(path);
            // Add directly to tree entry
            treeEntries.push({ 
                mode: FileSystem.mode(stats), 
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
    const tree = new TrakTree(treeEntries);
    // Write and return tree hash
    return await TrakObjectsBase.writeObject(tree, repo);
}
