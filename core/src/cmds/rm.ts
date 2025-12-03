import { resolve, join } from "path";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import { FileSystem } from "../lib/standard";

type RmArgs = {
    delete?: boolean
    skipMissing?: boolean
}

export async function rm(paths: string[], options: RmArgs = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Make paths absolute
    const absolutePaths = new Set<string>();
    for (const path of paths) {
        // Resolve path argument
        const absolutePath = resolve(path);
        if (absolutePath.startsWith(repo.workTree)) {
            absolutePaths.add(absolutePath);
        } else {
            throw new Error(`Cannot remove paths outside of worktree: ${ path }`);
        }
    }

    // Find and read the index
    await TrakIndex.load(repo);
    // The list of entries to *keep*, which we will write back to the
    const remove: string[] = [];

    for (const entryPath of TrakIndex.getFilePaths()) {
        const fullPath = join(repo.workTree, entryPath);
        if (absolutePaths.has(fullPath)) {
            remove.push(fullPath);
            absolutePaths.delete(fullPath);
            TrakIndex.remove(entryPath);
        }
    }

    // If abspaths is empty, it means some paths weren't in the index.
    if (absolutePaths.size > 0 && !options.skipMissing) {
        throw new Error(`Cannot remove paths not in the index: ${ absolutePaths }`);
    }

    // Physically delete paths from filesystem.
    if (options.delete) {
        for (const path of remove) {
            await FileSystem.removeFile(path);
        }
    }

    // Write it back
    await TrakIndex.save(repo);
}