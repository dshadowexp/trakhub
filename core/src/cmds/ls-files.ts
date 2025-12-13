import { TrakIndex } from "../db/t-index";
import { Terminal } from "../lib/standard";
import { TrakRepository } from "../repository";

interface LsFilesArgs {
    verbose?: boolean
    stage?: boolean
}

export async function lsFiles(options: LsFilesArgs = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Load index file
    await TrakIndex.load(repo);

    if (options.verbose)
        Terminal.println(`Index file format v${TrakIndex.version}, containing ${Object.keys(TrakIndex.entries).length} entries.`)
    
    for (const entry of TrakIndex.entries) {
        let info = entry.path;

        if (options.stage) {
            info = `${ entry.mode } ${ entry.sha1.toString("hex") } ${ entry.stage } ${ info }`;
        } else if (options.verbose) {

        }
            
        Terminal.println(info);
    }
}