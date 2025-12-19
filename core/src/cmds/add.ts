import { BaseCommand } from "./-base";
import { TBlob } from "../repo/objects";
import { Terminal } from "../lib/standard";

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
        );
    }

    async run(): Promise<void> { 
        try {
            // Get list of files from paths
            const paths = (await Promise.all(
                this._args.paths.map(path =>
                    this._repo!.workspace.listFiles(path)
                )
            )).flat();

            await this._repo!.index.load();
            await Promise.all(paths.map(([path, _]) => this._addToIndex(path)));
            await this._repo!.index.save();
        } catch (error: any) {
           Terminal.printerr(`${ error.message }`);
        }
    } 

    private async _addToIndex(filePath: string) {
        // Read the file content
        const fileContent = await this._repo!.workspace.readFile(filePath);
        // Create and Store blob object in database
        const blobHash = await this._repo!.objects.store(new TBlob(fileContent));
        // Get stats
        const stats = this._repo!.workspace.stats(filePath);
        // Add entry to Index entries
        this._repo!.index.add(filePath, blobHash, stats);
    }
}