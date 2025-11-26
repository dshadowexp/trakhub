import { dirname, join } from "path";
import { mkdir } from "fs/promises";
import { getBranchCommitFiles } from "../shared-helpers";
import { TrakFileSystem } from "../file-system";
import { TrakBlob, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import type { TrakTreeEntry } from "../types";
import { difference } from "../util";

export async function checkout(targetBranch: string, createBranch?: boolean) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    const filesInCurrent = await getBranchCommitFiles(repo, currentBranch);

    if (!targetBranch || targetBranch === currentBranch) {
        for (const fileContent of filesInCurrent) {
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
                process.stdout.write(`Branch ${ targetBranch } not found\n`);
                return;
            }
        }

        // Extract files in target branch
        const filesInTarget = await getBranchCommitFiles(repo, targetBranch);
        // Remove files that exist in current branch but not in target branch
        await _restoreWorkingDirectory(
            repo, 
            difference<string>(
                filesInCurrent.map((file) => file.name), 
                filesInTarget.map((file) => file.name)
            )
        );

        // Add or update files that exist in target branch
        await _restoreTree(repo, filesInTarget)
        // Clear current index and rebuild from target branch files
        await TrakIndex.clearIndex(repo);
        await TrakIndex.saveIndex(repo, filesInTarget.reduce((current, record) => {
            return { ...current, [record.name]: record.oid };
        }, {}));

        // Set HEAD to point to the target branch
        await TrakRefs.setCurrentBranch(repo, targetBranch);
    }
}

/**
 * 
 * @param repo 
 * @param files 
 */
async function _restoreTree(repo: TrakRepository, files: TrakTreeEntry[]) {
    // Restore Entries
    for (const { mode, name, oid } of files) {
        // Compute file path
        const fullPath = join(repo.workTree, name);
        // Create directory for file
        const dirPath = dirname(fullPath);
        await mkdir(dirPath, { recursive: true });
        // Read blob object from blob sha hash
        const blobObject = (await TrakObjectsBase.readObject(repo, oid)) as TrakBlob;
        const blob = TrakBlob.deserialize(blobObject.content);
        // Write blob content to file
        await TrakFileSystem.writeFile(fullPath, blob.content);
    }
}

/**
 * 
 * @param repo 
 * @param filesToClear 
 */
async function _restoreWorkingDirectory(repo: TrakRepository, filesToClear: string[]) {
    for (const relativePath of filesToClear.sort()) {
        // Compute file path
        const fullPath = join(repo.workTree, relativePath);

        try {
            // Skip if file does not exist
            if (!TrakFileSystem.exists(fullPath))
                continue;
            // Remove file and all empty parent directories
            await TrakFileSystem.removeFile(fullPath, repo.workTree);
        } catch (error) {
            console.log('Inside _restoreWorkingDirectory:', error); // Ignore error
        }
    }
}