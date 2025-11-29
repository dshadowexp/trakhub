import { TrakIndex } from "../db/t-index";
import { Terminal } from "../lib/standard";
import { TrakRepository } from "../repository";

type LsFilesArguments = {
    verbose?: boolean
}

export async function lsFiles(options: LsFilesArguments = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Load index file
    await TrakIndex.load(repo);
    if (options.verbose)
        Terminal.println(`Index file format v${TrakIndex.version}, containing ${Object.keys(TrakIndex.entries).length} entries.`)
    
    for (const entry of Object.keys(TrakIndex.entries)) {
        Terminal.println(entry);
    }
}