import { BaseCommand } from "../types";

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

    async execute(): Promise<void> {
        // Make paths absolute
        const paths = new Set([...this._args.paths]);

        // Load entries into the index
        await this._repo!.index.load();
        // The list of entries to *keep*, which we will write back to the
        const remove: string[] = [];
        
        for (const entry of this._repo!.index.eachEntry()) {
            if (paths.has(entry.path)) {
                remove.push(entry.path);
                paths.delete(entry.path);
                this._repo!.index.remove(entry.path);
            } else {
                throw new Error(`pathspec ${ entry.path } did not match any files`)
            }
        }

        // If abspaths is empty, it means some paths weren't in the index.
        if (paths.size > 0 && !this._args.skipMissing) {
            throw new Error(`Cannot remove paths not in the index: ${ paths }`);
        }

        // Physically delete paths from filesystem.
        if (this._args.delete) {
            await Promise.all(remove.map(path => this._repo?.workspace.removeFile(path)));
        }

        // Write it back
        await this._repo!.index.save();
    }
}