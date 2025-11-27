import { TrakObjectsBase, TrakTree } from "../db/objects";
import { TrakRepository } from "../repository";

export async function lsTree(treeHash: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const tree = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;
    for (const { mode, name, oid } of tree.entries) {
        const type = mode.startsWith("100") ? "blob" : "tree";
        process.stdout.write(`${ mode } ${ type } ${ oid } ${ name }\n`);
    }
}