import { TrakObjectsBase, TrakTree } from "../db/objects";
import { TrakRepository } from "../repository";
import { Terminal } from "../lib/standard";

export async function lsTree(treeHash: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const tree = (await TrakObjectsBase.readObject(repo, treeHash)) as TrakTree;
    for (const { mode, name, oid } of tree.entries) {
        const type = mode.startsWith("100") ? "blob" : "tree";
        Terminal.println(`${ mode } ${ type } ${ oid } ${ name }`);
    }
}