import { Terminal } from "../lib/standard";
import { BaseCommand } from "./-base";
import { commitTree } from "./-shared";

type CommitTreeArgs = {
    treeHash: string,
    parents: string[],
    message: string
}

export class CommitTree extends BaseCommand<CommitTreeArgs> {
    constructor(args: any[] = []) {
        super(
            'commit-tree', 
            'creates a commit object that points to',
            [
                { name: 'treeHash', type: String, defaultOption: true },
                { name: 'parents', alias: 'p', type: String, multiple: true },
                { name: 'message', alias: 'm', type: String },
            ],
            args
        )
    }

    async run(): Promise<void> {
        const { treeHash, parents, message } = this._args;
        const commit = await commitTree(this._repo!, treeHash, parents, message);
        Terminal.println(`[${ commit.hash }] ${ message }`);
    }
}