import { getTreeFilesFromCommit } from "./-shared";
import { FileSystem, Terminal } from "../lib/standard";
import { TrakBlob } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import type { TrakTreeEntry } from "../types";
import { asyncFilter, difference, intersection } from "../util";

export async function status(isPorcelain: boolean = false) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;
   
    // Load index (Staging area)
    await TrakIndex.load(repo);

    // COMPARE HEAD vs INDEX (staged changes)
    const indexAgainstHead = await compareHeadAgainstIndex(repo);
 
    // COMPARE INDEX vs WORKING DIRECTORY (unstaged changes)
    const workingDirAgainstIndex = await compareWorkingDirectoryAgainstIndex(repo);
    
    // 6. DISPLAY RESULTS
    if (isPorcelain) {
        printPorcelainFormat(indexAgainstHead, workingDirAgainstIndex);
    } else {
        const currentBranch = await TrakRefs.getCurrentBranch(repo);
        Terminal.println(`On branch ${ currentBranch }`);
        printLongFormat(indexAgainstHead, workingDirAgainstIndex);
    }
}

/**
 * 
 * @param repo 
 * @returns 
 */
export async function compareHeadAgainstIndex(repo: TrakRepository) {
    // Get current head commit
    const currentHeadCommit = await TrakRefs.getCurrentHeadCommit(repo);

    // Get committed files
    const committedFiles: Record<string, TrakTreeEntry> = (await getTreeFilesFromCommit(repo, currentHeadCommit!)).reduce((current, value) => {
        return { ...current, [value.name]: value }
    }, {});

    return await getStatus(TrakIndex.getFilePaths(), Object.keys(committedFiles), async (path) => TrakIndex.getEntry(path)!.sha1.toString("hex"), async (path) => committedFiles[path].oid);
}

/**
 * 
 * @param repo 
 * @returns 
 */
export async function compareWorkingDirectoryAgainstIndex(repo: TrakRepository) {
    // Scan working directory
    const workingFiles = await FileSystem.listFiles(repo.workTree);

    return await getStatus(workingFiles, TrakIndex.getFilePaths(), async (path) => {
        const fileData = await FileSystem.readFile(path);
        const blob = new TrakBlob(fileData);
        return blob.hash();
    }, async (path) => TrakIndex.getEntry(path)!.sha1.toString("hex"));
}

/**
 * 
 * @param filesA 
 * @param filesB 
 * @param getFileAOid 
 * @param getFileBOid 
 * @returns 
 */
async function getStatus(filesA: string[], filesB: string[], getFileAOid: (path: string) => Promise<string>, getFileBOid: (path: string) => Promise<string>): Promise<[string[], string[], string[]]> {
    const added = difference<string>(filesA, filesB);
    const modified = await asyncFilter<string>(intersection<string>(filesA, filesB), async (path) => { 
        const a = await getFileAOid(path);
        const b = await getFileBOid(path);
        return a != b;
    });
    const deleted = difference<string>(filesB, filesA);
    
    return [added, modified, deleted];
}

/**
 * 
 * @param indexAgainstHead 
 * @param workingDirAgainstIndex 
 */
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

/**
 * 
 * @param indexAgainstHead 
 * @param workingDirAgainstIndex 
 */
function printLongFormat(indexAgainstHead: [string[], string[], string[]], workingDirAgainstIndex: [string[], string[], string[]]) {
    const [stagedNew, stagedModified, stagedDeleted] = indexAgainstHead;
    const [untracked, unstagedModified, unstagedDeleted] = workingDirAgainstIndex;
    const conflicts: string[] = [];

    // Changes to be committed (staged)
    if (stagedNew.length > 0 || stagedModified.length > 0 || stagedDeleted.length > 0) {
        Terminal.println("Changes to be committed:");
        Terminal.println("  (use \"trak reset HEAD <file>...\" to unstage)");
        printFilesList(stagedNew, "\tnew file");
        printFilesList(stagedModified, "\tmodified");
        printFilesList(stagedDeleted, "\tdeleted");
        Terminal.println("");
    }

    // Unmerged paths
    if (conflicts.length > 0) {
        Terminal.println("Unmerged paths:");
        printFilesList(conflicts, "\t");
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
    if (stagedNew.length === 0 && stagedModified.length === 0 && stagedDeleted.length === 0 && 
            unstagedModified.length === 0 && unstagedDeleted.length === 0 && untracked.length === 0)
        Terminal.println("Nothing to commit, working tree clean");
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