import { getTreeFilesFromCommit, getStatus } from "./-shared";
import { FileSystem, Terminal } from "../lib/standard";
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
    const currentHeadCommit = await TrakRefs.getCurrentHeadCommit(repo);
    if (!currentHeadCommit) {
        Terminal.println(`No commits yet`);
        return;
    }
   
    
    // Get committed files
    const committedFiles: Record<string, TrakTreeEntry> = (await getTreeFilesFromCommit(repo, currentHeadCommit)).reduce((current, value) => {
        return { ...current, [value.name]: value }
    }, {});

    // Load index (Staging area)
    await TrakIndex.load(repo);
    const indexEntries = TrakIndex.entries;

    // Scan working directory
    const workingFiles = await FileSystem.listFiles(repo.workTree);

    // COMPARE HEAD vs INDEX (staged changes)
    const indexAgainstHead = await getStatus(Object.keys(indexEntries), Object.keys(committedFiles), async (path) => indexEntries[path].sha1.toString("ascii"), async (path) => committedFiles[path].oid);
 
    // COMPARE INDEX vs WORKING DIRECTORY (unstaged changes)
    const workingDirAgainstIndex = await getStatus(workingFiles, Object.keys(indexEntries), async (path) => indexEntries[path].sha1.toString("ascii"), async (path) => {
        const fileData = await FileSystem.readFile(path);
        const blob = new TrakBlob(fileData);
        return blob.hash();
    });
    
    // 6. DISPLAY RESULTS
    if (isPorcelain) {
        printPorcelainFormat(indexAgainstHead, workingDirAgainstIndex);
    } else {
        process.stdout.write(`On branch ${currentHeadCommit}\n`);
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
        Terminal.println("Changes to be committed:");
        Terminal.println("  (use \"trak reset HEAD <file>...\" to unstage)");
        printFilesList(stagedNew, "\tnew file");
        printFilesList(stagedModified, "\tmodified");
        printFilesList(stagedDeleted, "\tdeleted");
        Terminal.println("");
    }

    // Changes not staged for commit (modified/deleted in working dir)
    if (unstagedModified.length > 0 || unstagedDeleted.length > 0) {
        Terminal.println("Changes not staged for commit:");
        Terminal.println("  (use \"trak add/rm <file>...\" to update what will be committed)");
        Terminal.println("  (use \"trak checkout -- <file>...\" to discard changes in working directory)");
        printFilesList(unstagedModified, "\tmodified");
        printFilesList(unstagedDeleted, "\tdeleted");
        Terminal.println("");
    }

    if (untracked.length > 0) {
        Terminal.println("Untracked files:");
        Terminal.println("  (use \"trak add <file>...\" to include in what will be committed");
        printFilesList(untracked, "\t");
        Terminal.println("");
    }
    
    // Clean working tree message
    if (!(stagedNew || stagedModified || stagedDeleted || 
            unstagedModified || unstagedDeleted || untracked))
        Terminal.println("nothing to commit, working tree clean");
}

/**
 * 
 * @param filesList 
 * @param prefix 
 */
function printFilesList(filesList: string[], prefix: string) {
    for (const filePath of filesList.sort()) {
        Terminal.println(`${ prefix }  ${ filePath }`);
    }
}