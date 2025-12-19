import { BaseCommand } from "./-base";

type RmArgs = {
    paths: string[],
    delete?: boolean
    skipMissing?: boolean
    force?: boolean
    recursive?: boolean
}

export class Rm extends BaseCommand<RmArgs> {
    constructor(args: any[] = []) {
        super(
            'rm', 
            'removes paths from the index, and optionally from the working tree',
            [
                { name: 'paths', type: String, multiple: true, defaultOption: true },
                { name: 'delete', alias: 'D', type: Boolean },
                { name: 'skipMissing', alias: 'n', type: Boolean },
                { name: 'force', alias: 'f', type: Boolean },
                { name: 'recursive', alias: 'r', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        // Get list of files from paths
        const pathsList = (await Promise.all(
            this._args.paths.map(path =>
                this._repo!.workspace.listFiles(path)
            )
        )).flat();
        const paths = new Set([...pathsList.map(entry => entry[0])]);

        // Load entries into the index
        await this._repo!.index.load();
    
        for (const path of paths) {
            await this._removeFile(path);
        }

        // Write it back
        await this._repo!.index.save();
    }

    private async _removeFile(path: string) {
        this._repo!.index.remove(path);
        await this._repo?.workspace.removeFile(path);
        
    }

    private async _planRemoval(path: string) {
        if (!this._repo?.index.isTrackedFile(path)) {
            throw new Error(`pathspec ${ path } did not match any files`);
        }

        const item = await this._repo.objects.loadTreeEntry('head', path);
        const entry = this._repo.index.entryForPath(path);
        const stat = this._repo.workspace.stats(path);

        // if @inspector.compare_tree_to_index(item, entry)
        // @uncommitted.push(path)
        // elsif stat and @inspector.compare_index_to_workspace(entry, stat)
        // @unstaged.push(path)
        // end
    }
}