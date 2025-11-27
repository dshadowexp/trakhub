import { getBranchCommitFiles, hasUncommittedChanges, updateIndexFromTree, updateWorkingDirectory } from "./-shared";
import { TrakFileSystem } from "../file-system";
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
    if (await hasUncommittedChanges(repo, currentTree)) {
        throw new Error("Your local changes to the following files would be overwritten by checkout");
    }

    if (!targetBranch || targetBranch === currentBranch) {
        for (const fileContent of currentTree) {
            process.stdout.write(`M\t${ fileContent.name }\n`);
        }

        if (targetBranch === currentBranch) {
            process.stdout.write(`Already on '${targetBranch}'\n`);
        } else {
            process.stdout.write(`Your branch is up to date with '${ currentBranch }'\n`);
        }
    } else {
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", targetBranch);

        if (!TrakFileSystem.exists(branchFile!)) {
            if (createBranch) {
                const currentCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
                if (currentCommit) {
                    await TrakRefs.setBranchCommit(repo, targetBranch, currentCommit);
                    process.stdout.write(`Created new branch ${ targetBranch }\n`);
                } else {
                    process.stdout.write('No commits yet, cannot create branch\n');
                }
            } else {
                process.stdout.write(`error: pathspec ${ targetBranch } did not match any file(s) known to git\n`);
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