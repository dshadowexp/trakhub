import { resolve, join } from "path";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import { FileSystem } from "../lib/standard";
import { makePathsAbsolute } from "./-shared";

type RmArgs = {
    delete?: boolean
    skipMissing?: boolean
    force?: boolean
}

export async function rm(paths: string[], options: RmArgs = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Make paths absolute
    const absolutePaths = makePathsAbsolute(paths, repo.workTree);

    // Load entries into the index
    await TrakIndex.load(repo);
    // The list of entries to *keep*, which we will write back to the
    const remove: string[] = [];

    for (const entryPath of TrakIndex.getFilePaths()) {
        const fullPath = join(repo.workTree, entryPath);
        if (absolutePaths.has(fullPath)) {
            remove.push(fullPath);
            absolutePaths.delete(fullPath);
            TrakIndex.removeEntry(entryPath);
        } else {
            throw new Error(`pathspec ${ fullPath } did not match any files`)
        }
    }

    // If abspaths is empty, it means some paths weren't in the index.
    if (absolutePaths.size > 0 && !options.skipMissing) {
        throw new Error(`Cannot remove paths not in the index: ${ absolutePaths }`);
    }

    // Physically delete paths from filesystem.
    if (options.delete) {
        await Promise.all(remove.map(path => FileSystem.removeFile(path)));
    }

    // Write it back
    await TrakIndex.save(repo);
}