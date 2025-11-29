import { resolve, relative, join, delimiter } from "path";
import { TrakRepository } from "../repository";
import { TrakIndex } from "../db/t-index";
import { FileSystem } from "../lib/standard";
import type { TrakIndexEntry } from "../types";

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
    const keptEntries: TrakIndexEntry[] = [], remove: string[] = [];

    for (const entry of Object.values(TrakIndex.entries)) {
        const fullPath = join(repo.workTree, entry.path);
        if (absolutePaths.has(fullPath)) {
            remove.push(fullPath);
            absolutePaths.delete(fullPath);
        } else {
            keptEntries.push(entry);
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

    // Update the list of entries in the index, and write it back
    await TrakIndex.clear(repo);
    TrakIndex.entries = keptEntries.reduce((result, current) => {
        return { ...result, [current.path]: current }
    }, {});
    await TrakIndex.save(repo);
}