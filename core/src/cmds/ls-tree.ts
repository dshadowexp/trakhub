import { BaseCommand } from "./-base";
import { showTree } from "./-shared";

interface LsTreeArgs {
    hash: string;
    recursive?: boolean;
}

export class LsTree extends BaseCommand<LsTreeArgs> {
    constructor(args: any[] = []) {
        super(
            'ls-tree', 
            'lists the contents of a tree object',
            [
                { name: 'hash', type: String, multiple: false, defaultOption: true },
                { name: 'recursive', alias: 'r', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        await showTree(this._repo!, this._args.hash, this._args.recursive)
    }
}