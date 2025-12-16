import { getConfig } from "../repo/config";
import { TCommit, TObjects } from "../repo/objects";
import { TRefs } from "../repo/refs";
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
        const parentCommitObject = (await TObjects.readObject(repo, parents[0])) as TCommit;

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
    const commit = new TCommit(treeHash, parents, author, committer, message);
    const commitHash = await TObjects.writeObject(commit, repo);;

    // Update references - commit of current branch
    await TRefs.setCurrentHeadCommit(repo, commitHash);

    return commit.hash();
}