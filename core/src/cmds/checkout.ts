import { getBranchCommitFiles, hasUncommittedChanges, updateIndexFromTree, updateWorkingDirectory } from "./-shared";
import { FileSystem, Terminal } from "../standard-lib";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";

export async function checkout(targetBranch: string, createBranch?: boolean) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    const currentTree = await getBranchCommitFiles(repo, currentBranch);

    // Check for uncommitted changes
    if (await hasUncommittedChanges(repo)) {
        throw new Error("Your local changes to the following files would be overwritten by checkout");
    }

    if (!targetBranch || targetBranch === currentBranch) {
        for (const fileContent of currentTree) {
            Terminal.println(`M\t${ fileContent.name }`);
        }

        if (targetBranch === currentBranch) {
            Terminal.println(`Already on '${targetBranch}'`);
        } else {
            Terminal.println(`Your branch is up to date with '${ currentBranch }'`);
        }
    } else {
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", targetBranch);

        if (!FileSystem.exists(branchFile!)) {
            if (createBranch) {
                const currentCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
                if (currentCommit) {
                    await TrakRefs.setBranchCommit(repo, targetBranch, currentCommit);
                    Terminal.println(`Created new branch ${ targetBranch }`);
                } else {
                    Terminal.println('No commits yet, cannot create branch');
                }
            } else {
                Terminal.println(`error: pathspec ${ targetBranch } did not match any file(s) known to git`);
                return;
            }
        }

        // Extract files in target branch
        const targetTree = await getBranchCommitFiles(repo, targetBranch);
        // Remove files that exist in current branch but not in target branch
        // Add files from tree
        await updateWorkingDirectory(repo, currentTree, targetTree);

        // Clear current index and rebuild from target branch files
        await updateIndexFromTree(repo, targetTree);

        // Set HEAD to point to the target branch
        await TrakRefs.setCurrentBranch(repo, targetBranch);
    }
}