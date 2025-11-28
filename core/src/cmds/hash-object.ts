import type { TrakObjectTypeEnum } from "../types";
import { TrakBlob, TrakCommit, TrakObject, TrakObjectsBase, TrakTree } from "../db/objects";
import { TrakFileSystem } from "../file-system";
import { TrakRepository } from "../repository";

export async function hashObject(path: string, type: TrakObjectTypeEnum, write: boolean = false) {
    const repo = write ? await TrakRepository.repoFind() : null;
    const data = await TrakFileSystem.readFile(path);
    const baseObject = new TrakObject(type, data);
    
    let object;
    switch(type) {
        case 'blob':
            object = TrakBlob.deserialize(baseObject.content);
            break;
        case 'tree':
            object = TrakTree.deserialize(baseObject.content);
            break;
        case 'commit':
            object = TrakCommit.deserialize(baseObject.content);
            break;
        default:
            throw new Error(`Unknown type ${ type }`);
    }

    const hash = await TrakObjectsBase.writeObject(object, repo);
    process.stdout.write(`${hash}\n`);
}