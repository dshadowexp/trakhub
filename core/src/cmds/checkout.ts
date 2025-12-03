import { Terminal } from "../lib/standard";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { resolveStartPoint } from "../lib/revision";
import { treeDiff } from "../lib/tree-diff";
import { migrate } from "../lib/migration";
import { TrakIndex } from "../db/t-index";
import { createBranch } from "./branch";
import { hasUncommittedChanges } from "./-shared";

type CheckoutArgs = {
    createBranch?: boolean,
    startPoint?: string
}

export async function checkout(targetRef: string, options: CheckoutArgs) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Resolve and extract files in current commit
    const currentCommit = await TrakRefs.getCurrentHeadCommit(repo);
    if (!currentCommit)
        throw new Error(`Current error at current commit at HEAD`);

    // Load the index for updates
    await TrakIndex.load(repo);

    // Check if changes are uncommitted
    if (await hasUncommittedChanges(repo)) {
        throw new Error(`You have uncommitted changes. Commit or stash them first.`);
    }

    let targetCommit;
    if (options.createBranch) {
        const newBranchCommitHash = await createBranch(repo, targetRef, options.startPoint);
        if (!newBranchCommitHash) {
            throw new Error(`Not a valid object name: ${ options.startPoint }`);
        } else {
            targetCommit = newBranchCommitHash;
            Terminal.println(`Created new branch ${ targetRef }`);
        }
    } else {
        // Verify the reference exists
        targetCommit = await resolveStartPoint(repo, targetRef);
        if (!targetCommit)
            throw new Error(`error: pathspec ${ targetRef } did not match any file(s) known to git`);
    }

    // Resolve tree diff
    const changes = await treeDiff(repo, currentCommit, targetCommit);
    console.log(changes);

    // Apply changes with migration
    await migrate(repo, changes);

    // Write all updates to index
    await TrakIndex.save(repo);

    // Set HEAD to point to the target branch
    await TrakRefs.setCurrentBranch(repo, targetRef);
    if (options.createBranch)
        Terminal.println(`Switched to a new branch ${targetRef}`);
    else
        Terminal.println(`Switched to branch ${targetRef}`);
}
