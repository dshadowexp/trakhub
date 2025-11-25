import { mkdir, readdir } from "fs/promises";
import { join, relative, resolve } from "path";
import type { TrakAuthor, DirTree, TrakTreeEntry, TrakIndexRecord } from "./types";
import { DIRECTORY_MODE, EXECUTABLE_FILE_MODE, REGULAR_FILE_MODE, SYMBOLIC_LINK } from "./constants";
import { TrakRepository } from "./repository";
import { TrakBlob, TrakCommit, TrakObject, TrakTree, TrakObjectsBase } from "./objects";
import { TrakIndex } from "./t-index";
import { formatGitDate } from "./util";
import { TrakRefs } from "./refs";
import { TrakFileSystem } from "./file-system";

const IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'test2.txt'];

export async function createRepo(path: string) {
    const repo = new TrakRepository(path, true);

    if (TrakFileSystem.exists(repo.workTree)) {
        if (!TrakFileSystem.isDirectory(repo.workTree))
            throw new Error(`${ path } is not a directory`);
        if (TrakFileSystem.exists(repo.trakDir)) {
            try {
                if ((await readdir(repo.trakDir)).length > 0) {
                    throw new Error(`${ path } is not empty`);
                }
            } catch (error) {}
        }
    } else {
        await mkdir(repo.workTree);
    }

    await TrakRepository.repoDir(repo, true, "objects");
    await TrakRepository.repoDir(repo, true, "refs", "tags");
    await TrakRepository.repoDir(repo, true, "refs", "heads");

    const headFile = await TrakRepository.repoFile(repo, false, "HEAD");
    if (headFile)
        await TrakFileSystem.writeFile(headFile, 'ref: refs/heads/master');
    
    const descriptionFile = await TrakRepository.repoFile(repo, false, "description");
    if (descriptionFile)
        await TrakFileSystem.writeFile(descriptionFile, "Unnamed repository; edit this file 'description' to name the repository.\n");

    return repo;
}

export async function hashObject(path: string, type: string, write: boolean = false) {
    const repo = write ? await TrakRepository.repoFind() : null;
    const data = await TrakFileSystem.readFile(path);
    const baseObject = new TrakObject(type, data);
    
    let object;
    switch(type) {
        case 'blob':
            object = TrakBlob.deserialize(baseObject.content);
            break;
        case 'tree':
            object = TrakTree.deserialize(baseObject.content);
            break;
        case 'commit':
            object = TrakTree.deserialize(baseObject.content);
            break;
        default:
            throw new Error(`Unknown type ${ type }`);
    }

    const hash = await TrakObjectsBase.writeObject(object, repo);
    process.stdout.write(`${hash}\n`);
}

export async function catFile(objectHash: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const object = await TrakObjectsBase.readObject(repo, objectFind(repo, objectHash));
    process.stdout.write(`${ object?.serialize().toString() }\n` || '');

    function objectFind(repo: TrakRepository, name: string, fmt=null, follow=true) {
        return name;
    }
}

export async function lsTree(treeHash: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const tree = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;
    for (const { mode, name, oid } of tree.entries) {
        const type = mode.startsWith("100") ? "blob" : "tree";
        process.stdout.write(`${ mode } ${ type } ${ oid } ${ name }\n`);
    }
}

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

export async function checkout(targetBranch: string, createBranch?: boolean) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const previousBranch = await TrakRefs.getCurrentBranch(repo);
    let filesToClear = new Set<string>();
    let previousCommitHash;

    try {
        previousCommitHash = await TrakRefs.getBranchCommit(repo, previousBranch);
        if (previousCommitHash) {
            const previousCommit = (await TrakObjectsBase.readObject(repo, previousCommitHash)) as TrakCommit;

            // Check for uncommitted changed
            // return with "You have uncommitted changed. Commit or stash them first";

            // Get the tree of files from the target commit
            filesToClear = await _getFilesFromTree(repo, previousCommit.treeHash);

        }
    } catch (error) {
        filesToClear = new Set();
    }

    console.log(filesToClear);

    if (!targetBranch || targetBranch === previousBranch) {
        for (const file of filesToClear) {
            process.stdout.write(`M\t${ file }\n`);
        }
        
        if (targetBranch === previousBranch) {
            process.stdout.write(`Already on '${targetBranch}'\n`);
        } else {
            process.stdout.write(`Your branch is up to date with '${ previousBranch }'\n`);
        }
    } else {
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", targetBranch);

        if (!TrakFileSystem.exists(branchFile!)) {
            if (createBranch) {
                if (previousCommitHash) {
                    await TrakRefs.setBranchCommit(repo, targetBranch, previousCommitHash);
                    process.stdout.write(`Created new branch ${ targetBranch }\n`);
                } else {
                    process.stdout.write('No commits yet, cannot create branch\n');
                }
            } else {
                process.stdout.write(`Branch ${ targetBranch } not found\n`);
                return;
            }
        }

        await TrakRefs.setCurrentBranch(repo, targetBranch);
        await _restoreWorkingDirectory(repo, targetBranch, filesToClear);
    }
}

export async function branch(branchName: string, deleteBranch: boolean = false) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    if (deleteBranch && branchName) {
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile)
            return;

        if (TrakFileSystem.exists(branchFile)) {
            await TrakFileSystem.removeFile(branchFile);
            process.stdout.write(`Delete branch ${ branchName }\n`);
        } else {
            process.stdout.write(`Branch ${ branchName } not found`);
        }

        return;
    }

    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    if (branchName) {
        const currentCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
        if (currentCommit) {
            await TrakRefs.setBranchCommit(repo, branchName, currentCommit);
            process.stdout.write(`Created branch ${ branchName }\n`);
        } else {
            process.stdout.write('No commits yet, cannot create a new branch\n');
        }
    } else {
        const headsDir = await TrakRepository.repoDir(repo, true, "refs", "heads");
        if (!headsDir) 
            return

        const branches = [];
        for (const file of await readdir(headsDir, { withFileTypes: true })) {
            if (file.isFile() && !file.name.startsWith('.')) {
                branches.push(file.name);
            }
        }

        // check for empty branches
        for (const branch of branches.sort()) {
            const currentMarker = branch == currentBranch ? "* " : "  ";
            process.stdout.write(`${ currentMarker }${ branch }\n`);
        }
    }
}

export async function log(maxCount: number = 10) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    let commitHash = await TrakRefs.getBranchCommit(repo, currentBranch)

    if (!commitHash) {
        process.stdout.write("No commits yet!\n");
        return;
    }

    let count = 0;
    while (commitHash && count < maxCount) {
        const commit = (await TrakObjectsBase.readObject(repo, commitHash)) as TrakCommit;

        process.stdout.write(`commit ${ commitHash }\n`);
        process.stdout.write(`Author: ${ commit.author.serialize() }\n`);
        process.stdout.write(`Date:   ${ formatGitDate(commit.author.timestamp) }\n`);
        process.stdout.write(`\n    ${ commit.message }\n\n`);

        commitHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : undefined;
        count += 1
    }
}

// ************************************************************************************************/
// Helper functions

async function _getStatus(repo: TrakRepository) {}

async function _getFilesFromTree(repo: TrakRepository, treeHash: string, prefix: string = ""): Promise<Set<string>> {
    let files = new Set<string>();
    if (!treeHash)
        return files;

    try {
        const treeObject = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;

        for (const { mode, name, oid } of treeObject.entries) {
            // Compute relative file path
            const fullPath = join(prefix, name);

            if (mode.startsWith("100")) {
                files.add(`${ fullPath } ${ oid }`);
            } else if (mode.startsWith("040")) {
                // Recurse into directories
                const subTreeFiles = await _getFilesFromTree(repo, oid, fullPath);
                // Merge files and sub directory files
                files = new Set([...files, ...subTreeFiles]);
            }
        }
    } catch (error) {
        process.stdout.write(`Warning: Could not read tree ${treeHash}: ${error}`);
    }

    return files;
}

async function _restoreWorkingDirectory(repo: TrakRepository, branchName: string, filesToClear: Set<string>) {
    const targetCommitHash = await TrakRefs.getBranchCommit(repo, branchName);
    if (!targetCommitHash)
        return

    for (const relativePath of [...filesToClear].sort()) {
        // Compute file path
        const fullPath = join(repo.workTree, relativePath);

        try {
            // Skip if file does not exist
            if (!TrakFileSystem.exists(fullPath))
                continue;

            await TrakFileSystem.removeFile(fullPath, repo.workTree);
        } catch (error) {
            console.log('Inside', error);
            // Ignore error
        }
    }

    const targetCommitObject = (await TrakObjectsBase.readObject(repo, targetCommitHash)) as TrakCommit;
    if (targetCommitObject.treeHash) {
        await _restoreTree(repo, targetCommitObject.treeHash, repo.workTree);
    }

    await TrakIndex.clearIndex(repo);
}

async function _restoreTree(repo: TrakRepository, treeHash: string, pathPrefix: string) {
    // Read new tree object from tree sha hash
    const treeObject = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;

    // Restor Entries
    for (const { mode, name, oid } of treeObject.entries) {
        // Compute file path
        const fullPath = join(pathPrefix, name);

        if (mode.startsWith("100")) {
            // Read blob object from blob sha hash
            const blobObject = (await TrakObjectsBase.readObject(repo, oid)) as TrakBlob;
            const blob = TrakBlob.deserialize(blobObject.content);
            // Write blob content to file
            await TrakFileSystem.writeFile(fullPath, blob.content);
        } else if (mode.startsWith("040")) {
            // Create directory if absent
            await mkdir(fullPath, { recursive: true });
            // Recurse of directory path
            await _restoreTree(repo, oid, fullPath);
        }
    }
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
function _organizeIntoHierarchy(indexEntries: Record<string, string>) {
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

async function _addDirectory(dirPath: string, repo: TrakRepository) {
    // Load index file json contents
    const indexJSON = await TrakIndex.loadIndex(repo);
    const stack: string[] = [dirPath];

    while (stack.length > 0) {
        // Get current directory from stack
        const currentDir = stack.pop()!;
        // Read entries from directory
        const entries = (await readdir(currentDir)).filter((element) => !IGNORE.includes(element));

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