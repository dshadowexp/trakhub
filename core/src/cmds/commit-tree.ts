import { getConfig } from "../db/config";
import { TrakCommit, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs";
import { Terminal } from "../lib/standard";
import { TrakRepository } from "../repository";
import { TrakAuthor } from "../types";

type CommitTreeArgs = {
    treeHash: string,
    parents: string[],
    message: string
}

export async function commitTree(options: CommitTreeArgs, repo?: TrakRepository | null): Promise<string | null> {
    if (!repo)
        repo = await TrakRepository.repoFind();
        if (!repo)
            return null;

    const { treeHash, parents, message } = options;

    // Verify no changes from computed hashes
    if (parents.length > 0) {
        const parentCommitObject = (await TrakObjectsBase.readObject(repo, parents[0])) as TrakCommit;

        if (parentCommitObject.treeHash === treeHash) {
            Terminal.println('Nothing to commit, working tree clean');
            return null;
        }
    }

    // Construct author
    const cfg = await getConfig('global');  
    const name = process.env.TRAK_AUTHOR_NAME || cfg.get('user', 'name') || 'Unknown';
    const email = process.env.TRAK_AUTHOR_EMAIL || cfg.get('user', 'email') || 'Unknown';
    const author = new TrakAuthor(name, email);
    const committer = new TrakAuthor(name, email);

    // Create commit object
    const commit = new TrakCommit(treeHash, parents, author, committer, message);
    const commitHash = await TrakObjectsBase.writeObject(commit, repo);;

    // Update references - commit of current branch
    await TrakRefs.setCurrentHeadCommit(repo, commitHash);

    return commit.hash();
}