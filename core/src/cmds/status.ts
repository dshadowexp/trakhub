import { getBranchCommitFiles } from "./-shared";
import { TrakFileSystem } from "../file-system";
import { TrakBlob, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import type { TrakTreeEntry } from "../types";
import { asyncFilter, difference, intersection } from "../util";

export async function status() {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    process.stdout.write(`On branch ${currentBranch}\n`);

    // Get committed files
    const committedFiles: Record<string, TrakTreeEntry> = (await getBranchCommitFiles(repo, currentBranch)).reduce((current, value) => {
        return { ...current, [value.name]: value }
    }, {});

    // Load index (Staging area)
    const indexEntries = await TrakIndex.loadIndex(repo);

    // Scan working directory
    const workingFiles = await TrakFileSystem.listFiles(repo.workTree);

    // COMPARE HEAD vs INDEX (staged changes)
    // Files added to index, not in HEAD
    const stagedNew: string[] = difference<string>(Object.keys(indexEntries), Object.keys(committedFiles));
    // Files in both, but different content    
    const stagedModified: string[] = intersection<string>(Object.keys(indexEntries), Object.keys(committedFiles)).filter((filePath) => indexEntries[filePath] != committedFiles[filePath].oid);
    // Files in HEAD but not in index (deleted)
    const stagedDeleted: string[] = difference<string>(Object.keys(committedFiles), Object.keys(indexEntries));
   
    // COMPARE INDEX vs WORKING DIRECTORY (unstaged changes)
    // Files in working dir, not in index
    const untracked = difference<string>(workingFiles, Object.keys(indexEntries));
    // Files in index, but modified in working dir
    const unstagedModified = await asyncFilter<string>(intersection<string>(Object.keys(indexEntries), workingFiles), async (filePath) => {
        // Read the file content
        const fileData = await TrakFileSystem.readFile(filePath);
        // Create and Store blob object in database
        const blobHash = await TrakObjectsBase.writeObject(new TrakBlob(fileData), repo);
        // Compare SHA1 hash of files
        return blobHash != indexEntries[filePath];
    })
    // Files in index, but deleted from working dir
    const unstagedDeleted = difference<string>(Object.keys(indexEntries), workingFiles);   
    
    // 6. DISPLAY RESULTS
    function printFilesList(filesList: string[], prefix: string) {
        for (const filePath of filesList.sort()) {
            process.stdout.write(`     ${ prefix }  ${ filePath }\n`);
        }
    }
    
    // Changes to be committed (staged)
    if (stagedNew.length > 0 || stagedModified.length > 0 || stagedDeleted.length > 0) {
        process.stdout.write("Changes to be committed:\n");
        process.stdout.write("  (use \"trak restore --staged <file>...\" to unstage)\n");
        printFilesList(stagedNew, "  new file");
        printFilesList(stagedModified, "  modified");
        printFilesList(stagedDeleted, "  deleted");
        process.stdout.write("\n");
    }

    // Changes not staged for commit (modified/deleted in working dir)
    if (unstagedModified.length > 0 || unstagedDeleted.length > 0) {
        process.stdout.write("Changes not staged for commit:\n");
        process.stdout.write("  (use \"trak add <file>...\" to update what will be committed)\n");
        process.stdout.write("  (use \"trak restore <file>...\" to discard changes in working directory)\n");
        printFilesList(unstagedModified, "  modified");
        printFilesList(unstagedDeleted, "  deleted");
        process.stdout.write("\n");
    }

    if (untracked.length > 0) {
        process.stdout.write("Untracked files:\n");
        process.stdout.write("  (use \"trak add <file>...\" to include in what will be committed\n");
        printFilesList(untracked, "");
        process.stdout.write("\n");
    }
    
    // Clean working tree message
    if (!(stagedNew || stagedModified || stagedDeleted || 
            unstagedModified || unstagedDeleted || untracked))
        process.stdout.write("nothing to commit, working tree clean\n");
}