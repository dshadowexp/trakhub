import { join } from "path";
import { TBlob } from "../repo/objects";
import { BaseCommand } from "../types";

interface AddArgs {
    paths: string[]
}

export class Add extends BaseCommand<AddArgs> {
    constructor(args: any[] = []) {
        super(
            'add', 
            'add files to the index',
            [
                { name: 'paths', type: String, multiple: true, defaultOption: true },
            ],
            args
        )
    }

    async execute(): Promise<void> {
        // Load index
        await this._repo!.index.load();

        for (const path of this._args.paths) {
            // Ensure path exists
            if (!this._repo!.workspace.exists(path))
                throw new Error(`Path ${path} not found`);

            if (this._repo!.workspace.isFile(path)) {
                // Add file to object
                await this._addFile(path);
            } else if (this._repo!.workspace.isDirectory(path)) {
                // Add files in directory
                await this._addDirectory(path);
            } else {
                throw new Error(`${path} is neither a file nor directory`);
            }
        }

        // Write all entries to index file
        await this._repo!.index.save();
    } 

    private async _addDirectory(dirPath: string) {
        // Load index file json contents
        // const indexJSON = await TrakIndex.loadIndex(repo);
        const stack: string[] = [dirPath];
    
        while (stack.length > 0) {
            // Get current directory from stack
            const currentDir = stack.pop()!;
            // Read entries from directory
            const entries = await this._repo!.workspace.readDirectory(currentDir) as string[];
    
            // Populate stack and process file entries
            for (const entry of entries) {
                // Resolve full path for directory entry
                const fullPath = join(currentDir, entry);
    
                if (this._repo!.workspace.isDirectory(fullPath)) {
                    // Push to stack if path is a directory
                    stack.push(fullPath);
                } else {
                    await this._addFile(fullPath);
                }
            }
        }
    }

    private async _addFile(filePath: string) {
        // Read the file content
        const fileContent = await this._repo!.workspace.readFile(filePath);
        // Create and Store blob object in database
        const blobHash = await this._repo!.objects.writeObject(new TBlob(fileContent), true);
        // Add entry to Index entries
        this._repo!.index.add(filePath, blobHash, this._repo!.workspace.stats(filePath));
    }
}