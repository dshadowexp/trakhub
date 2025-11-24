import { mkdir, readdir } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import type { TrakAuthor, DirTree } from "./types";
import { DIRECTORY_MODE } from "./constants";
import { TrakRepository } from "./repository";
import { TrakObjectsBase } from "./database";
import { TrakBlob, TrakCommit, TrakObject, TrakTree } from "./objects";
import { TrakIndex } from "./t-index";

const IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'test2.txt'];

export async function createRepo(path: string) {
    const repo = new TrakRepository(path, true);

    if (TrakRepository.exists(repo.workTree)) {
        if (!TrakRepository.isDirectory(repo.workTree))
            throw new Error(`${ path } is not a directory`);
        if (TrakRepository.exists(repo.trakDir)) {
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
        await TrakRepository.writeFile(headFile, 'ref: refs/heads/master');
    
    const descriptionFile = await TrakRepository.repoFile(repo, false, "description");
    if (descriptionFile)
        await TrakRepository.writeFile(descriptionFile, "Unnamed repository; edit this file 'description' to name the repository.\n");

    return repo;
}

export async function hashObject(path: string, type: string, write: boolean = false) {
    const repo = write ? await TrakRepository.repoFind() : null;
    const data = await TrakRepository.readFile(path);
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
    if (!TrakRepository.exists(fullPath))
        throw new Error(`Path ${fullPath} not found`);

    // Extract stats to process file and directory seperately
    const fileStats = TrakRepository.stats(fullPath);
    if (TrakRepository.isFile(fullPath)) {
        // Add file to object
        await _addFile(fullPath, repo);
    } else if (TrakRepository.isDirectory(fullPath)) {
        // Add directory
        await _addDirectory(fullPath, repo);
    } else {
        throw new Error(`${fullPath} is neither a file nor directory`);
    }
}

export async function commit(message: string, author: TrakAuthor) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const currentBranch = await _getCurrentBranch(repo);
    const parentCommit = await _getBranchCommit(repo, currentBranch);
    const parentHashes = parentCommit !== undefined ? [ parentCommit ] : [];

    const indexContent = await TrakIndex.loadIndex(repo);
    const treeHash = await _createTreeFromIndex(repo, indexContent);

    if (Object.keys(indexContent).length === 0) {
        process.stdout.write('Nothing to commit, working tree clean - first\n');
        return null;
    }

    if (parentCommit) {
        const parentCommitData = (await TrakObjectsBase.readObject(repo, parentCommit)) as TrakCommit;

        if (parentCommitData.treeHash === treeHash) {
            process.stdout.write('Nothing to commit, working tree clean - second\n');
            return null;
        }
    }

    const commit = new TrakCommit(treeHash, parentHashes, author, author, message);
    const commitHash = await TrakObjectsBase.writeObject(commit, repo);;

    await _setBranchCommit(repo, currentBranch, commitHash);
    await TrakIndex.saveIndex(repo, {});

    // if parentHashes.length > 0  // use branch otherwise root commit
    const commitPointer = parentHashes.length > 0 ? currentBranch : currentBranch;
    process.stdout.write(`[${ commitPointer } ${ commitHash }] ${ message }\n`);
    return commitHash;
}

export async function log() {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const currentBranch = await _getCurrentBranch(repo);
    let commitHash = await _getBranchCommit(repo, currentBranch)

    if (!commitHash) {
        process.stdout.write("No commits yet!\n");
        return;
    }

    let count = 0;
    const maxCount = 10;
    while (commitHash && count < maxCount) {
        const commit = (await TrakObjectsBase.readObject(repo, commitHash)) as TrakCommit;

        process.stdout.write(`commit ${ commitHash }\n`);
        process.stdout.write(`Author: ${ commit.author.serialize() }\n`);
        process.stdout.write(`Date: ${ new Date(commit.author.timestamp * 1000).toString() }\n`);
        process.stdout.write(`\n    ${ commit.message }\n`);

        commitHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : undefined;
        count += 1
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

        if (TrakRepository.exists(branchFile)) {
            await TrakRepository.removeFile(repo, branchFile);
            process.stdout.write(`Delete branch ${ branchName }\n`);
        } else {
            process.stdout.write(`Branch ${ branchName } not found`);
        }

        return;
    }

    const currentBranch = await _getCurrentBranch(repo);
    if (branchName) {
        const currentCommit = await _getBranchCommit(repo, currentBranch);
        if (currentCommit) {
            await _setBranchCommit(repo, branchName, currentCommit);
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

export async function checkout(branchName?: string, createBranch?: boolean) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const previousBranch = await _getCurrentBranch(repo);
    let filesToClear = new Set<string>();
    let previousCommitHash;

    try {
        previousCommitHash = await _getBranchCommit(repo, previousBranch);
        if (previousCommitHash) {
            const previousCommit = (await TrakObjectsBase.readObject(repo, previousCommitHash)) as TrakCommit;
            if (previousCommit.treeHash) {
                // Populate files recursively
                filesToClear = await _getFilesFromTree(repo, previousCommit.treeHash);
            }
        }
    } catch (error) {
        filesToClear = new Set();
    }

    if (!branchName || branchName === previousBranch) {
        for (const file of filesToClear) {
            process.stdout.write(`M\t${ file }\n`);
        }
        
        if (branchName === previousBranch) {
            process.stdout.write(`Already on '${branchName}'\n`);
        }

        process.stdout.write(`Your branch is up to date with '${ previousBranch }'\n`);
    } else {
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile)
            throw new Error('heads folder is missing');

        if (!TrakRepository.exists(branchFile)) {
            if (createBranch) {
                if (previousCommitHash) {
                    await _setBranchCommit(repo, branchName, previousCommitHash);
                    process.stdout.write(`Created new branch ${ branchName }\n`);
                } else {
                    process.stdout.write('No commits yet, cannot create branch\n');
                }
            } else {
                process.stdout.write(`Branch ${ branchName } not found\n`);
                return;
            }
        }

        const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
        if (!headFilePath)
            throw new Error('HEAD file is missing');

        await TrakRepository.writeFile(headFilePath, `ref: refs/heads/${branchName}\n`);
        await _restoreWorkingDirectory(repo, branchName, filesToClear);
    }
}

// ************************************************************************************************/
// Helper functions

async function _getFilesFromTree(repo: TrakRepository, treeHash: string, prefix: string = ""): Promise<Set<string>> {
    let files = new Set<string>();

    try {
        const treeObject = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;
        const tree = TrakTree.deserialize(treeObject.content);
        for (const { mode, name, oid } of tree.entries) {
            const fullPath = join(prefix, name);
            if (mode.startsWith("100")) {
                files.add(fullPath);
            } else if (mode.startsWith("400")) {
                const subTreeFiles = await _getFilesFromTree(repo, oid, fullPath);
                files = new Set([...files, ...subTreeFiles]);
            }
        }
    } catch (error) {
        process.stdout.write(`Warning: Could not read tree ${treeHash}: ${error}`);
    }

    return files;
}

async function _restoreWorkingDirectory(repo: TrakRepository, branch: string, filesToClear: Set<string>) {
    const targetCommitHash = await _getBranchCommit(repo, branch);

    if (!targetCommitHash)
        return

    for (const relativePath of [...filesToClear].sort()) {
        const fullPath = await TrakRepository.repoFile(repo, false, repo.workTree, relativePath);
        if (!fullPath)
            continue
        try {
            if (!TrakRepository.exists(fullPath))
                continue;

            await TrakRepository.removeFile(repo, fullPath, true);
        } catch (error) {
            // Ignore error
        }
    }

    const targetCommitObject = (await TrakObjectsBase.readObject(repo, targetCommitHash)) as TrakCommit;
    const targetCommit = TrakCommit.deserialize(targetCommitObject.content);

    if (targetCommit.treeHash) {
        await _restoreTree(repo, targetCommit.treeHash, repo.workTree);
    }

    await TrakIndex.saveIndex(repo, {});
}

async function _restoreTree(repo: TrakRepository, treeHash: string, pathPrefix: string) {
    const treeObject = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;
    const tree = TrakTree.deserialize(treeObject.content);

    for (const { mode, name, oid } of tree.entries) {
        if (mode.startsWith("100")) {
            // Compute file path
            const fullPath = await TrakRepository.repoFile(repo, true, pathPrefix, name);
            if (!fullPath) 
                continue;
            // Read blob object from hash
            const blobObject = (await TrakObjectsBase.readObject(repo, oid)) as TrakBlob;
            const blob = TrakBlob.deserialize(blobObject.content);
            // Write blob content to file
            await TrakRepository.writeFile(fullPath, blob.content);
        } else if (mode.startsWith("040")) {
            // Compute directory path
            const fullPath = await TrakRepository.repoDir(repo, true, pathPrefix, name);
            if (!fullPath)
                continue;
            // Recurse of directory path
            await _restoreTree(repo, oid, fullPath);
        }
    }
}

async function _createTreeFromIndex(repo: TrakRepository, indexEntries: Record<string, string>): Promise<string> {
    // Store empty tree for empty index entries
    if (Object.keys(indexEntries).length === 0) {
        return await TrakObjectsBase.writeObject(new TrakTree(), repo);
    }

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

    const rootDirTree: DirTree = { ...files };
    for (const [dirName, dirContents] of Object.entries(dirs)) {
        rootDirTree[dirName] = dirContents;
    }

    return await _createTreeRecursive(repo, rootDirTree);
}

async function _createTreeRecursive(repo: TrakRepository, dirTree: DirTree, prefix: string = ""): Promise<string> {
    // Initialize a new Tree
    const tree = new TrakTree();

    for (const [name, content] of Object.entries(dirTree)) {
        const path = join(prefix, name);
        if (typeof content === 'string') {
            const stats = TrakRepository.stats(path);
            tree.addEntry({ mode: stats.mode.toString(8), name, oid: content });
        } else if (typeof content === 'object') {
            const subtreeHash = await _createTreeRecursive(repo, content, path);
            tree.addEntry({ mode: DIRECTORY_MODE, name, oid: subtreeHash });
        }
    }

    return await TrakObjectsBase.writeObject(tree, repo);
}

async function _addFile(filePath: string, repo: TrakRepository) {
    // Read the file content
    const fileData = await TrakRepository.readFile(filePath);
    // Create and Store blob object in database
    const blobHash = await TrakObjectsBase.writeObject(new TrakBlob(fileData), repo);
    // Load index file json contents
    const indexJSON = await TrakIndex.loadIndex(repo);
    // Map blob hash to file path: [path] -> hash
    indexJSON[relative(repo.workTree, filePath)] = blobHash;;
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

            if (TrakRepository.isDirectory(fullPath)) {
                // Push to stack if path is a directory
                stack.push(fullPath);
            } else {
                // Read the file content
                const fileData = await TrakRepository.readFile(fullPath);
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

async function _getCurrentBranch(repo: TrakRepository): Promise<string> {
    const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
    if (!headFilePath || !TrakRepository.exists(headFilePath))
        return "master";

    const headContent = (await TrakRepository.readFile(headFilePath)).toString().trim();
    const prefix = 'ref: refs/heads/';
    if (headContent.startsWith(prefix))
        return headContent.substring(prefix.length)

    // detached HEAD
    return "HEAD";
}

async function _getBranchCommit(repo: TrakRepository, currentBranch: string) {
    const headsDir = await TrakRepository.repoDir(repo, true, "refs", "heads");
    if (!headsDir) 
        return

    // Construct branch file path
    const branchFile = join(headsDir, currentBranch);
    // Validate the existence of the file
    if (TrakRepository.exists(branchFile))
        return (await TrakRepository.readFile(branchFile)).toString().trim();
}

async function _setBranchCommit(repo: TrakRepository, currentBranch: string, commitHash: string) {
    const headsDir = await TrakRepository.repoDir(repo, true, "refs", "heads");
    if (!headsDir) 
        return

    const branchFile = join(headsDir, currentBranch);
    await TrakRepository.writeFile(branchFile, commitHash);
}