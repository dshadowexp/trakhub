import { Dirent } from "fs";
import { TrakRefs } from "../db/refs";
import { TrakFileSystem } from "../file-system";
import { TrakRepository } from "../repository";

export async function branch(branchName: string, deleteBranch: boolean = false) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    if (deleteBranch && branchName) {
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile)
            return;

        if (TrakFileSystem.exists(branchFile)) {
            await TrakFileSystem.removeFile(branchFile);
            process.stdout.write(`Delete branch ${ branchName }\n`);
        } else {
            process.stdout.write(`Branch ${ branchName } not found`);
        }

        return;
    }

    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    if (branchName) {
        const currentCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
        if (currentCommit) {
            await TrakRefs.setBranchCommit(repo, branchName, currentCommit);
            process.stdout.write(`Created branch ${ branchName }\n`);
        } else {
            process.stdout.write('No commits yet, cannot create a new branch\n');
        }
    } else {
        const headsDir = await TrakRepository.repoDir(repo, true, "refs", "heads");
        if (!headsDir) 
            return

        const branches = [];
        for (const file of (await TrakFileSystem.readDirectory(headsDir, true) as Dirent[])) {
            if (file.isFile() && !file.name.startsWith('.')) {
                branches.push(file.name);
            }
        }

        // check for empty branches
        for (const branch of branches.sort()) {
            const currentMarker = branch == currentBranch ? "* " : "  ";
            process.stdout.write(`${ currentMarker }${ branch }\n`);
        }
    }
}