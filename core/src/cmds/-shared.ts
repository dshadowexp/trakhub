import { TCommit, TTree } from "../repo/objects";
import { Terminal } from "../lib/standard";
import type { TRepository } from "../repo/repository";
import { TrakAuthor } from "../repo/author";

// ************************************************************************************************/
// Shared Command Helper functions

export async function showTree(repo: TRepository, treeHash: string, recursive: boolean | undefined, prefix: string = "") {
    const tree = await repo.objects.loadTree(treeHash);

    for (const [name, entry] of tree.entries.entries()) {
        const type = entry.mode.startsWith("100") ? "blob" : "tree";
        if (type === "tree" && recursive) { //if (entry.isTree()) {
            await showTree(repo, entry.hash!, recursive, `${ prefix }${ name }/`);
        } else {
            Terminal.println(`${ entry.mode } ${ type } ${ entry.hash } ${ prefix }${ name }`);
        }
    }
}

export async function writeTree(repo: TRepository) {
    const tree = TTree.build(repo.index.eachEntry());

    for (const subTree of tree.traverse()) {
        await repo.objects.store(subTree);
    }

    return tree;
}

export async function currentAuthor(repo: TRepository) {
    const cfg = await repo.config.getConfig('local');  
    const name = process.env.TRAK_AUTHOR_NAME || cfg.get('user', 'name') || 'Unknown name';
    const email = process.env.TRAK_AUTHOR_EMAIL || cfg.get('user', 'email') || 'Unknown email';
    return new TrakAuthor(name, email);   
}

export async function commitTree(repo: TRepository, treeHash: string, parents: string[] = [], message: string = ''): Promise<TCommit> {
    // Construct author
    const currAuthor = await currentAuthor(repo);
    const author = currAuthor;
    const committer = currAuthor;

    // Create commit object
    const commit = new TCommit(treeHash, parents, author, committer, message);
    await repo.objects.store(commit);;
    return commit;
}

export async function writeCommit(repo: TRepository, parents: string[], message: string): Promise<TCommit | null> {
    if (repo.index.size === 0) {
        Terminal.println('Nothing to commit, working tree clean - first');
        return null;
    }

    // Build tree and commit
    const tree = await writeTree(repo);

    // Verify no changes from computed hashes
    if ((parents.length === 1) && (await repo.objects.loadCommit(parents[0])).treeHash === tree.hash) {
        Terminal.println('Nothing to commit, working tree clean');
        return null;
    }

    const commit = await commitTree(repo, tree.hash!, parents, message);
    await repo!.refs.updateHead(commit.hash!);
    return commit;
}