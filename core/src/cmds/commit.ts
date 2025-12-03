import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import { Terminal } from "../lib/standard";
import { writeTree } from "./write-tree";
import { commitTree } from "./commit-tree";

export async function commit(message: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get parent commit
    const parentCommit = await TrakRefs.getCurrentHeadCommit(repo);
    // Create commit object
    const parentHashes = !parentCommit ? [] : [ parentCommit ];

    // Write Commit to objects
    const commitHash = await writeCommit(repo, parentHashes, message);
    if (!commitHash)
        return;

    // Get current branch
    const currentBranchName = await TrakRefs.getCurrentBranch(repo);
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
    // Read the index (staging area)
    await TrakIndex.load(repo);
    if (TrakIndex.entries.length === 0) {
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
    await TrakRefs.setCurrentHeadCommit(repo, commitHash);

    return commitHash;
}
