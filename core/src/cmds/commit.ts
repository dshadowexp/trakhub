import { Terminal } from "../lib/standard";
import { BaseCommand } from "./-base";
import { commitTree, writeCommit, writeTree } from "./-shared";

type CommitArgs = {
    message: string
}

export class Commit extends BaseCommand<CommitArgs> {
    constructor(args: any[] = []) {
        super(
            'commit-tree', 
            'creates a commit object that points to',
            [
                { name: 'message', alias: 'm', type: String },
            ],
            args
        )
    }

    async run(): Promise<void> {
        const { message } = this._args;

         // Get parent commit
        const headCommit = await this._repo!.refs.readHead();
        const parentHashes = !headCommit ? [] : [ headCommit ];

        // Read the index (staging area)
        await this._repo!.index.load();
        
        // Check for merge in progress
        // handle_in_progress_merge if pending_commit.in_progress?
        // if (await PendingCommit.inProgress(repo)) {
        //     await resumeMerge(repo, headCommit!);
        //     return;
        // }

        const commit = await writeCommit(this._repo!, parentHashes, message);
        
        const isRoot = parentHashes.length === 0 ? '(root-commit)' : 'current-branch';
        Terminal.println(`[${ isRoot } ${ commit?.hash }] ${ message }`);
    }
}
