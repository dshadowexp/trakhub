import { TrakCommit, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakIndex } from "../db/t-index";
import { resolveStartPoint } from "../lib/revision";
import { FileSystem } from "../lib/standard";
import { TrakRepository } from "../repository";
import type { TrakTreeEntry } from "../types";
import { getTreeFilesFromCommit, makePathsAbsolute } from "./-shared";

interface ResetArgs {
    paths: string[]
    startPoint?: string
    mode?: 'soft' | 'mixed' | 'hard'
}

export async function reset(options: ResetArgs = { paths: [], mode: 'mixed' }) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Make paths absolute
    const absolutePaths = makePathsAbsolute(options.paths, repo.workTree);

    // Get parent commit
    let commitHash: string | null;
    if (options.startPoint) {
        commitHash = await resolveStartPoint(repo, options.startPoint);
    } else {
        commitHash = await TrakRefs.getCurrentHeadCommit(repo);
    }

    if (!commitHash)
        throw new Error(`No commit found for ${ options.startPoint }`);

    const resetFiles = async () => {
        if (options.mode === 'soft') return;
        if (options.mode === 'hard') {
            const headCommitHash = await TrakRefs.getCurrentHeadCommit(repo);
            const headTreeEntries = await getTreeFilesFromCommit(repo, commitHash!);
            
            return;
        }

        // Load tree list
        const treeEntries = await getTreeFilesFromCommit(repo, commitHash!);
    
        if (absolutePaths.size == 0) {
            TrakIndex.clear();
            resetPath('', []);
        } else {
            absolutePaths.forEach((absPath) => {
                resetPath(absPath, treeEntries.filter((entry) => entry.name.startsWith(absPath)));
            })
        }
    }
    
    const resetPath = (path: string, listing: TrakTreeEntry[]) => {
        TrakIndex.removeEntry(path);
        listing.map(entry => TrakIndex.addFromDb(path, entry));
    }

    const resetPathHard = async (path: string, entry: TrakTreeEntry) => {
        TrakIndex.removeEntry(path);
        await FileSystem.removeFile(path, repo.workTree);
    }

    // Load entries into the index
    await TrakIndex.load(repo);

    // Reset files
    await resetFiles();

    // Write updates to index
    await TrakIndex.save(repo);

    // Update HEAD to the selected commit if no file paths were given
    if (options.paths.length === 0) {
        await TrakRefs.setCurrentHeadCommit(repo, commitHash!);
    }
}

