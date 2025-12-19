import { BaseCommand } from "./-base";
import { SymRef } from "../repo/refs";
import { Terminal } from "../lib/standard";
import { Revision } from "../lib/revision";

interface BranchArgs { 
    branches?: string[],
    verbose?: boolean, 
    delete?: boolean,
    force?: boolean,
}

export class Branch extends BaseCommand<BranchArgs> {
    constructor(args: any[] = []) {
        super(
            'branch', 
            'Manage branches',
            [
                { name: 'branches', type: String, multiple: true, defaultOption: true },
                { name: 'verbose', alias: 'v', type: Boolean },
                { name: 'delete', alias: 'D', type: Boolean },
                { name: 'force', alias: 'f', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        if (this._args.delete) {
            await this._deleteBranches();
        } else if (Object.keys(this._args).length === 0) {
            await this._listBranches();
        }  else {
            await this._createBranch();
        }
    } 

    private async _listBranches() {
        const current = await this._repo!.refs.currentRef();
        const branches = await this._repo!.refs.listBranches();
        branches.sort((a, b) => a.path.localeCompare(b.path));
        const maxWidth = 10;

        for (const ref of branches) {
            const info = this._formatRef(ref, current);
            const extended = await this._extendedBranchInfo(ref, maxWidth);
            Terminal.println([info, extended].join(''));
        }
    }

    private _formatRef(ref: SymRef, current: SymRef ) {
        if (ref.path === current.path) {
            return `* ${ ref.shortName }`;
        } else {
            return `  ${ ref.shortName }`;
        }   
    }

    private async _extendedBranchInfo(ref: SymRef, maxWidth: number) {
        if (!this._args.verbose) return "";
        const commit = await this._repo!.objects.loadCommit((await ref.readHash())!);
        const short = this._repo?.objects.shortHash(commit.hash!);
        const space = " ";
        return `${ space } ${ short } ${ commit.titleLine }`;
    }

    private async _createBranch() {
        let revision: Revision | undefined;
        try {
            const branchName = this._args.branches![0];
            const startPoint = this._args.branches![1] ?? null;

            let commitHash: string | null | undefined;
            if (startPoint) {
                revision = new Revision(this._repo!, startPoint);
                commitHash = await revision.resolve();
            } else {
                commitHash = await this._repo?.refs.readHead();
            }

            if (!commitHash)
                return;

            await this._repo?.refs.createBranch(branchName, commitHash);
        } catch (error: any) {
            console.log(revision?.errors);
            // if (error is )
            Terminal.printerr(`fatal: ${ (error as any).message }`);
            process.exit(128);
        }
    }

    private async _deleteBranches() {
        await Promise.all(this._args.branches!.map((branchName) => this._deleteBranch(branchName)));
    }

    private async _deleteBranch(branchName: string) {
        if (!this._args.force) return;

        const hash = await this._repo!.refs.deleteBranch(branchName);
        const short = this._repo!.objects.shortHash(hash);
        Terminal.println(`deleted branch ${ branchName } (was ${ short })`);
    }
}

// async function _isBranchMerged(repo: TrakRepository, branchCommit: string) {
//     // Check if a branch is merged into HEAD
//     // Get current branch
//     const currentBranch = await TRefs.getCurrentBranch(repo);
//     const headCommit = await TRefs.getBranchCommit(repo, currentBranch);
//     if (!headCommit)
//         return null;

//     return await _isAncestor(repo, branchCommit, headCommit);
// }

// /**
//  * 
//  * @param repo 
//  * @param ancestorSha 
//  * @param descendantSha 
//  * @returns 
//  */
// async function _isAncestor(repo: TrakRepository, ancestorSha: string, descendantSha: string): Promise<boolean> {
//     const visited = new Set<string>();
//     const queue: string[] = [descendantSha];

//     while (queue.length > 0) {
//         const currentSha = queue.shift()!;

//         if (currentSha === ancestorSha) {
//             return true;
//         }

//         if (visited.has(currentSha)) {
//             continue;
//         }

//         visited.add(currentSha);

//         // Load the commit object
//         const commit = (await TObjects.readObject(repo, currentSha)) as TCommit;

//         // commit._parentHashes is an array of parent SHAs
//         if (commit.parentHashes && commit.parentHashes.length > 0) {
//             for (const parent of commit.parentHashes) {
//                 queue.push(parent);
//             }
//         }
//     }

//     return false;
// }

