import { Revision } from "../lib/revision";
import { BaseCommand } from "./-base";

type CheckoutArgs = {
    createBranch?: boolean,
    startPoint?: string
}

export class Checkout extends BaseCommand<CheckoutArgs> {
    constructor(args: any[] = []) {
        super(
            'checkout', 
            'lists the contents of a tree object',
            [
                { name: 'hash', type: String, multiple: false, defaultOption: true },
                { name: 'recursive', alias: 'r', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        const branchName = 'this._args.branches![0]';
        const startPoint = this._args.startPoint;

        let commitHash: string | null | undefined;
        if (startPoint) {
            const revision = new Revision(this._repo!, startPoint);
            commitHash = await revision.resolve();
        } else {
            commitHash = await this._repo?.refs.readHead();
        }

        if (!commitHash)
            return;
    }
}

// export async function checkout(targetRef: string, options: CheckoutArgs) {

//     // Resolve and extract files in current commit
//     const currentCommit = await TRefs.getCurrentHeadCommit(repo);
//     if (!currentCommit)
//         throw new Error(`Current error at current commit at HEAD`);

//     // Load the index for updates
//     await TIndex.load(repo);

//     // Check if changes are uncommitted
//     if (await hasUncommittedChanges(repo)) {
//         throw new Error(`You have uncommitted changes. Commit or stash them first.`);
//     }

//     let targetCommit;
//     if (options.createBranch) {
//         const newBranchCommitHash = await createBranch(repo, targetRef, options.startPoint);
//         if (!newBranchCommitHash) {
//             throw new Error(`Not a valid object name: ${ options.startPoint }`);
//         } else {
//             targetCommit = newBranchCommitHash;
//             Terminal.println(`Created new branch ${ targetRef }`);
//         }
//     } else {
//         // Verify the reference exists
//         targetCommit = await resolveStartPoint(repo, targetRef);
//         if (!targetCommit)
//             throw new Error(`error: pathspec ${ targetRef } did not match any file(s) known to git`);
//     }

//     // Resolve tree diff
//     const changes = await treeDiff(repo, currentCommit, targetCommit);

//     // Apply changes with migration
//     await migrate(repo, changes);

//     // Write all updates to index
//     await TIndex.save(repo);

//     // Set HEAD to point to the target branch
//     await TRefs.setCurrentBranch(repo, targetRef);

//     if (options.createBranch) {
//         Terminal.println(`Switched to a new branch ${targetRef}`);
//     } else {
//         Terminal.println(`Switched to branch ${targetRef}`);
//     }
// }
