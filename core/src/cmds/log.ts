import { TrakCommit, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
import { Terminal } from "../lib/standard";
import { formatGitDate } from "../util";

export async function log(maxCount: number = 10) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    let commitHash = await TrakRefs.getBranchCommit(repo, currentBranch)

    if (!commitHash) {
        process.stdout.write("No commits yet!\n");
        return;
    }

    const history = historyGenerator(repo, commitHash, maxCount);
    let current = await history.next();
    
    while (!current.done) {
        const next = await history.next();
        // Check if `next` is done. If so, `current` is the last item.
        // For the last item, write it without a trailing newline.
        // For all other items, print with a newline.
        Terminal.println(`${ current.value }${ next.done ? '' : '\n'}`);
        current = next;
    }
}

async function* historyGenerator(repo: TrakRepository, commitHash: string, maxCount: number = 10): AsyncGenerator<string> {
    const queue: string[] = [];
    queue.push(commitHash);
    let count = 0;

    while (queue.length > 0 && count < maxCount) {
        const currentCommit = queue.shift()!;
        const commit = (await TrakObjectsBase.readObject(repo, currentCommit)) as TrakCommit;
        yield [
            `commit ${ currentCommit }\n`,
            `Author: ${ commit.author.serialize() }\n`,
            `Date:   ${ formatGitDate(commit.author.timestamp) }\n`,
            `\n\t${ commit.message }`
        ].join('');
        queue.push(...commit.parentHashes);
        count += 1
    }
}