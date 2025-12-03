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

    let count = 0;
    const logs: string[] = [];
    while (commitHash && count < maxCount) {
        const commit = (await TrakObjectsBase.readObject(repo, commitHash)) as TrakCommit;

        logs.push([
            `commit ${ commitHash }\n`,
            `Author: ${ commit.author.serialize() }\n`,
            `Date:   ${ formatGitDate(commit.author.timestamp) }\n`,
            `\n\t${ commit.message }`
        ].join(''));

        commitHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : null;
        count += 1
    }

    Terminal.println(logs.join('\n'));
}