import { FileSystem, Terminal } from "../lib/standard";
import { TrakBlob, TrakCommit, TrakObject, TrakObjectsBase, TrakObjectType, TrakTree } from "../db/objects";

export async function hashObject(path: string, type: string, write: boolean = false) {
    const data = await FileSystem.readFile(path);
    const baseObject = new TrakObject(type as TrakObjectType, data);
    
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

    const hash = await TrakObjectsBase.writeObject(object);
    Terminal.println(hash);
}