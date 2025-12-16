import { TRefs } from "../repo/refs";
import { TrakRepository } from "../repository";
import { TIndex } from "../repo/t-index";
import { Terminal } from "../lib/standard";
import { writeTree } from "./write-tree";
import { commitTree } from "./commit-tree";
import { PendingCommit } from "../repo/pending-commit";
import { resumeMerge } from "./merge";

export async function commit(message: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get parent commit
    const headCommit = await TRefs.getCurrentHeadCommit(repo);
    // Create commit object
    const parentHashes = !headCommit ? [] : [ headCommit ];

    // Read the index (staging area)
    await TIndex.load(repo);

    // Check for merge in progress
    // handle_in_progress_merge if pending_commit.in_progress?
    if (await PendingCommit.inProgress(repo)) {
        await resumeMerge(repo, headCommit!);
        return;
    }

    // Write Commit to objects
    const commitHash = await writeCommit(repo, parentHashes, message);
    if (!commitHash)
        return;

    // Get current branch
    const currentBranchName = await TRefs.getCurrentBranch(repo);
    const commitPointer = parentHashes.length > 0 ? currentBranchName : 'root-commit';
    Terminal.println(`[${ commitPointer } ${ commitHash }] ${ message }`);
}

/**
 * 
 * @param repo 
 * @param parents 
 * @param message 
 * @returns 
 */
export async function writeCommit(repo: TrakRepository, parents: string[], message: string): Promise<string | null> {
    if (TIndex.entries.length === 0) {
        Terminal.println('Nothing to commit, working tree clean - first');
        return null;
    }

    // Build tree from index
    const treeHash = await writeTree(repo);
    if (!treeHash)
        return null;

    // Build commit hash
    const commitHash = await commitTree({ treeHash, parents, message}, repo);
    if (!commitHash)
        return null;

    // Update references - commit of current branch
    await TRefs.setCurrentHeadCommit(repo, commitHash);

    return commitHash;
}
