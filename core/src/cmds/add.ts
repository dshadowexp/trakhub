import { resolve, relative, join } from "path";
import { FileSystem } from "../lib/standard";
import { TrakBlob, TrakObjectsBase } from "../db/objects";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import { makePathsAbsolute } from "./-shared";
import { Command } from "../types";

interface AddArgs {
    paths: string[]
}

export class Add extends Command<AddArgs> {
    constructor(args: any[] = []) {
        super(
            'add', 
            'add files',
            [
                { name: 'paths', type: String, multiple: true, defaultOption: true },
            ],
            args
        )
    }

    async execute(): Promise<void> {
        await super.execute();
        console.log(this._args);

        const repo = await TrakRepository.repoFind();
        if (!repo)
            return;
        
        // Make paths absolute
        const absolutePaths = makePathsAbsolute(this._args.paths, repo.workTree);

        // Load index
        await TrakIndex.load(repo);

        for (const fullPath of absolutePaths) {
            // Ensure path exists
            if (!FileSystem.exists(fullPath))
                throw new Error(`Path ${fullPath} not found`);

            if (FileSystem.isFile(fullPath)) {
                // Add file to object
                await this._addFile(fullPath, repo);
            } else if (FileSystem.isDirectory(fullPath)) {
                // Add files in directory
                await this._addDirectory(fullPath, repo);
            } else {
                throw new Error(`${fullPath} is neither a file nor directory`);
            }
        }

        // Write all entries to index file
        await TrakIndex.save(repo);
    } 

    private async _addDirectory(dirPath: string, repo: TrakRepository) {
        // Load index file json contents
        // const indexJSON = await TrakIndex.loadIndex(repo);
        const stack: string[] = [dirPath];
    
        while (stack.length > 0) {
            // Get current directory from stack
            const currentDir = stack.pop()!;
            // Read entries from directory
            const entries = await FileSystem.readDirectory(currentDir) as string[];
    
            // Populate stack and process file entries
            for (const entry of entries) {
                // Resolve full path for directory entry
                const fullPath = join(currentDir, entry);
    
                if (FileSystem.isDirectory(fullPath)) {
                    // Push to stack if path is a directory
                    stack.push(fullPath);
                } else {
                    await _addFile(fullPath, repo);
                }
            }
        }
    }

    private async _addFile(filePath: string, repo: TrakRepository) {
        // Read the file content
        const fileContent = await FileSystem.readFile(filePath);
        // Create and Store blob object in database
        const blobHash = await TrakObjectsBase.writeObject(new TrakBlob(fileContent), repo);
        // Add entry to Index entries
        TrakIndex.addEntry(relative(repo.workTree, filePath), blobHash);
    }
}


export async function add(paths: string[]) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;
    
    // Make paths absolute
    const absolutePaths = makePathsAbsolute(paths, repo.workTree);

    // Resolve path argument
    const fullPath = resolve(paths[0]);
    // Ensure path exists
    if (!FileSystem.exists(fullPath))
        throw new Error(`Path ${fullPath} not found`);

    // Load index file
    await TrakIndex.load(repo);

    if (FileSystem.isFile(fullPath)) {
        // Add file to object
        await _addFile(fullPath, repo);
    } else if (FileSystem.isDirectory(fullPath)) {
        // Add files in directory
        await _addDirectory(fullPath, repo);
    } else {
        throw new Error(`${fullPath} is neither a file nor directory`);
    }

    // Write all entries to index file
    await TrakIndex.save(repo);
}

/**
 * 
 * @param filePath 
 * @param repo 
 */
async function _addFile(filePath: string, repo: TrakRepository) {
    // Read the file content
    const fileContent = await FileSystem.readFile(filePath);
    // Create and Store blob object in database
    const blobHash = await TrakObjectsBase.writeObject(new TrakBlob(fileContent), repo);
    // Add entry to Index entries
    TrakIndex.addEntry(relative(repo.workTree, filePath), blobHash);
}

/**
 * 
 * @param dirPath 
 * @param repo 
 */
async function _addDirectory(dirPath: string, repo: TrakRepository) {
    // Load index file json contents
    // const indexJSON = await TrakIndex.loadIndex(repo);
    const stack: string[] = [dirPath];

    while (stack.length > 0) {
        // Get current directory from stack
        const currentDir = stack.pop()!;
        // Read entries from directory
        const entries = await FileSystem.readDirectory(currentDir) as string[];

        // Populate stack and process file entries
        for (const entry of entries) {
            // Resolve full path for directory entry
            const fullPath = join(currentDir, entry);

            if (FileSystem.isDirectory(fullPath)) {
                // Push to stack if path is a directory
                stack.push(fullPath);
            } else {
                await _addFile(fullPath, repo);
            }
        }
    }
}