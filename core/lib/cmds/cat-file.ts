import { TrakObjectsBase } from "../db/objects";
import { TrakRepository } from "../repository";

export async function catFile(objectHash: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const object = await TrakObjectsBase.readObject(repo, objectFind(repo, objectHash));
    process.stdout.write(`${ object?.serialize().toString() }\n` || '');

    function objectFind(repo: TrakRepository, name: string, fmt=null, follow=true) {
        return name;
    }
}