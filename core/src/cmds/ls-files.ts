import { BaseCommand } from "./-base";
import { Terminal } from "../lib/standard";
import { TIndex } from "../repo/t-index";

interface LsFilesArgs {
    verbose?: boolean
    stage?: boolean
}

export class LsFiles extends BaseCommand<LsFilesArgs> {
    constructor(args: any[] = []) {
        super(
            'ls-files', 
            'List files in index',
            [
                { name: 'verbose', alias: 'w', type: Boolean },
                { name: 'stage', alias: 's', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        // Load index file
        await this._repo!.index.load();

        if (this._args.verbose)
            Terminal.println(`Index file format v${TIndex.VERSION}, containing ${ this._repo!.index.size } entries.`)
        
        for (const entry of this._repo!.index.eachEntry()) {
            let info = entry.path;

            if (this._args.stage) {
                info = `${ entry.mode } ${ entry.hash } ${ entry.stage } ${ info }`;
            } else if (this._args.verbose) {

            }
                
            Terminal.println(info);
        }
    }
}