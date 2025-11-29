import { getTreeFilesFromCommit, hasUncommittedChanges, updateIndexFromTree, updateWorkingDirectory } from "./-shared";
import { Terminal } from "../lib/standard";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { resolveStartPoint } from "../lib/revision";

type CheckoutArgs = {
    createBranch?: boolean,
    startPoint?: string
}

export async function checkout(targetRef: string, options: CheckoutArgs) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    let targetCommitHash;
    if (options.createBranch) {
        // Check if branch already exists
        if (await TrakRefs.branchExists(repo, targetRef))
            throw new Error(`branch ${targetRef} already exists`);

        // Determine starting point for new branch
        if (!options.startPoint)
            options.startPoint = "HEAD";

        // Resolve the starting commit
        targetCommitHash = await resolveStartPoint(repo, options.startPoint);
        if (!targetCommitHash)
            throw new Error(`Not a valid object name: ${options.startPoint}`);

        // Create the new branch pointing to the commit
        await TrakRefs.setBranchCommit(repo, targetRef, targetCommitHash);
        Terminal.println(`Created new branch ${ targetRef }`);
    } else {
        // Verify the reference exists
        targetCommitHash = await resolveStartPoint(repo, targetRef);
        if (!targetCommitHash)
            throw new Error(`error: pathspec ${ targetRef } did not match any file(s) known to git`);
    }

    // Extract files in target commit
    const targetTree = await getTreeFilesFromCommit(repo, targetCommitHash);

    // Resolve and extract files in current commit
    const currentCommit = await TrakRefs.getCurrentHeadCommit(repo);
    if (!currentCommit)
        throw new Error(`Current head commit corrupted`);
    const currentTree = await getTreeFilesFromCommit(repo, currentCommit);

    // Check for uncommitted changes
    if (await hasUncommittedChanges(repo, currentTree))
        throw new Error("Your local changes to the following files would be overwritten by checkout");
    
    // Remove files that exist in current branch but not in target branch
    // Add files from tree
    await updateWorkingDirectory(repo, currentTree, targetTree);

    // Clear current index and rebuild from target branch files
    await updateIndexFromTree(repo, targetTree);

    // Set HEAD to point to the target branch
    await TrakRefs.setCurrentBranch(repo, targetRef);
    if (options.createBranch)
        Terminal.println(`Switched to a new branch ${targetRef}`);
    else
        Terminal.println(`Switched to branch ${targetRef}`);
}