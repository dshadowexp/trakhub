import { getBranchCommitFiles, getStatus } from "./-shared";
import { TrakFileSystem } from "../file-system";
import { TrakBlob } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import type { TrakTreeEntry } from "../types";

export async function status(isPorcelain: boolean = false) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    
    // Get committed files
    const committedFiles: Record<string, TrakTreeEntry> = (await getBranchCommitFiles(repo, currentBranch)).reduce((current, value) => {
        return { ...current, [value.name]: value }
    }, {});

    // Load index (Staging area)
    const indexEntries = await TrakIndex.loadIndex(repo);

    // Scan working directory
    const workingFiles = await TrakFileSystem.listFiles(repo.workTree);

    // COMPARE HEAD vs INDEX (staged changes)
    const indexAgainstHead = await getStatus(Object.keys(indexEntries), Object.keys(committedFiles), async (path) => indexEntries[path], async (path) => committedFiles[path].oid);
 
    // COMPARE INDEX vs WORKING DIRECTORY (unstaged changes)
    const workingDirAgainstIndex = await getStatus(workingFiles, Object.keys(indexEntries), async (path) => indexEntries[path], async (path) => {
        const fileData = await TrakFileSystem.readFile(path);
        const blob = new TrakBlob(fileData);
        return blob.hash();
    });
    
    // 6. DISPLAY RESULTS
    if (isPorcelain) {
        printPorcelainFormat(indexAgainstHead, workingDirAgainstIndex);
    } else {
        process.stdout.write(`On branch ${currentBranch}\n`);
        printLongFormat(indexAgainstHead, workingDirAgainstIndex);
    }
}

function printPorcelainFormat(indexAgainstHead: [string[], string[], string[]], workingDirAgainstIndex: [string[], string[], string[]]) {
    const [stagedNew, stagedModified, stagedDeleted] = indexAgainstHead;
    const [untracked, unstagedModified, unstagedDeleted] = workingDirAgainstIndex;

    printFilesList(stagedNew, " N");
    printFilesList(stagedModified, " M");
    printFilesList(stagedDeleted, " D");
    printFilesList(untracked, "??");
    printFilesList(unstagedModified, " M");
    printFilesList(unstagedDeleted, " D");
}

function printLongFormat(indexAgainstHead: [string[], string[], string[]], workingDirAgainstIndex: [string[], string[], string[]]) {
    const [stagedNew, stagedModified, stagedDeleted] = indexAgainstHead;
    const [untracked, unstagedModified, unstagedDeleted] = workingDirAgainstIndex;

    // Changes to be committed (staged)
    if (stagedNew.length > 0 || stagedModified.length > 0 || stagedDeleted.length > 0) {
        process.stdout.write("Changes to be committed:\n");
        process.stdout.write("  (use \"trak reset HEAD <file>...\" to unstage)\n");
        printFilesList(stagedNew, "\tnew file");
        printFilesList(stagedModified, "\tmodified");
        printFilesList(stagedDeleted, "\tdeleted");
        process.stdout.write("\n");
    }

    // Changes not staged for commit (modified/deleted in working dir)
    if (unstagedModified.length > 0 || unstagedDeleted.length > 0) {
        process.stdout.write("Changes not staged for commit:\n");
        process.stdout.write("  (use \"trak add/rm <file>...\" to update what will be committed)\n");
        process.stdout.write("  (use \"trak checkout -- <file>...\" to discard changes in working directory)\n");
        printFilesList(unstagedModified, "\tmodified");
        printFilesList(unstagedDeleted, "\tdeleted");
        process.stdout.write("\n");
    }

    if (untracked.length > 0) {
        process.stdout.write("Untracked files:\n");
        process.stdout.write("  (use \"trak add <file>...\" to include in what will be committed\n");
        printFilesList(untracked, "\t");
        process.stdout.write("\n");
    }
    
    // Clean working tree message
    if (!(stagedNew || stagedModified || stagedDeleted || 
            unstagedModified || unstagedDeleted || untracked))
        process.stdout.write("nothing to commit, working tree clean\n");
}

function printFilesList(filesList: string[], prefix: string) {
    for (const filePath of filesList.sort()) {
        process.stdout.write(`${ prefix }  ${ filePath }\n`);
    }
}