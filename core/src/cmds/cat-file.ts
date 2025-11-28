import { TrakObjectsBase } from "../db/objects";
import { TrakRepository } from "../repository";
import { Terminal } from "../lib/standard";

export async function catFile(objectHash: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const object = await TrakObjectsBase.readObject(repo, objectFind(repo, objectHash));
    Terminal.println(`${ object?.serialize().toString() }` || '');

    function objectFind(repo: TrakRepository, name: string, fmt=null, follow=true) {
        return name;
    }
}