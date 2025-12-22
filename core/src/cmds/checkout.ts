import type { Migration } from "../lib/migration";
import { Revision } from "../lib/revision";
import { Terminal } from "../lib/standard";
import { TObjectType } from "../repo/objects";
import type { SymRef } from "../repo/refs";
import { BaseCommand } from "./-base";

export const DETACHED_HEAD_MESSAGE = `
You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by performing another checkout.
If you want to create a new branch to retain commits you create, you may
do so (now or later) by using the branch command. Example:
jit branch <new-branch-name>
`.trim();

type CheckoutArgs = {
    branch: string,
    startPoint?: string
    create?: boolean
}

export class Checkout extends BaseCommand<CheckoutArgs> {
    private _target: string | null = null;
    private _currentRef: SymRef | null = null;
    private _newRef: SymRef | null = null;
    private _currentOid: string | null = null;
    private _targetOid: string | null = null;

    constructor(args: any[] = []) {
        super(
            'checkout', 
            'lists the contents of a tree object',
            [
                { name: 'branch', type: String, multiple: false, defaultOption: true },
                { name: 'startPoint', type: String },
                { name: 'create', alias: 'b', type: Boolean },
            ],
            args
        );

    }

    async run(): Promise<void> {
        // let revision: Revision | undefined;
        try {
            // Extract into logic - also inside branch
            this._target = this._args.branch;
            const startPoint = this._args.startPoint;

            this._currentRef = await this._repo!.refs.currentRef();
            this._currentOid = await this._currentRef.readHash();
            console.log(this._currentOid);

            const revision = new Revision(this._repo!, this._target);
            this._targetOid = await revision.resolve(TObjectType.COMMIT);
            console.log(this._targetOid)

            await this._repo!.index.load();

            const treeDiff = await this._repo!.objects.treeDiff(this._currentOid!, this._targetOid);
            console.log(treeDiff);
            const migration = this._repo!.migration(treeDiff);
            await migration.applyChanges();

            await this._repo!.index.save();
            await this._repo!.refs.setHead(this._target, this._targetOid);
            this._newRef = await this._repo!.refs.currentRef();

            await this._printPreviousHead();
            this._printDetachmentNotice();
            this._printNewHead();

            process.exit(0);
        } catch (error) {
            console.log(error);
        }
    }

    private async _printPreviousHead() {
        if (this._currentRef?.isHead() && (this._currentOid === this._targetOid)) {
            await this._printHeadPosition("Previous HEAD position was", this._currentOid);
        }
    }

    private _printDetachmentNotice() {
        if (!(this._currentRef?.isHead() && !this._newRef?.isHead())) return;

        Terminal.printerr(`Note: checking out ${ this._target }`);
        Terminal.printerr("");
        Terminal.printerr(DETACHED_HEAD_MESSAGE);
        Terminal.printerr("");
    }

    private _printNewHead() {
        if (this._newRef?.isHead()) {
            this._printHeadPosition("HEAD is now at", this._targetOid);
        } else if (this._newRef === this._currentRef) {
            Terminal.printerr(`Already on ${ this._target }`);
        } else {
            Terminal.printerr(`Switched to branch ${ this._target }`);
        }
    }

    private async _printHeadPosition(message: string, oid: string | null) {
        if (!oid) return;
        const commit = await this._repo!.objects.loadCommit(oid);
        const short = this._repo!.objects.shortHash(oid);
        Terminal.printerr(`${ message } ${ short } ${ commit.titleLine }`);
    }

    private _handleInvalidObject(revision: Revision, error: Error) {
        revision.errors.forEach((err) => {
            Terminal.printerr(`error: ${ err.message }`);
            // err.hint.each { |line| @stderr.puts "hint: #{ line }" }
        });
        Terminal.printerr(`error: ${ error.message }`)
    }

    private _handleMigrationConflict(migration: Migration) {
        migration.errors.forEach((message) => {
            Terminal.printerr(`error: ${ message }`);
        });
        Terminal.printerr("Aborting");
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
