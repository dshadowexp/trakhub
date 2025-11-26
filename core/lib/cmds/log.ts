import { TrakCommit, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { TrakRepository } from "../repository";
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
    while (commitHash && count < maxCount) {
        const commit = (await TrakObjectsBase.readObject(repo, commitHash)) as TrakCommit;

        process.stdout.write(`commit ${ commitHash }\n`);
        process.stdout.write(`Author: ${ commit.author.serialize() }\n`);
        process.stdout.write(`Date:   ${ formatGitDate(commit.author.timestamp) }\n`);
        process.stdout.write(`\n\t${ commit.message }\n\n`);

        commitHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : undefined;
        count += 1
    }
}