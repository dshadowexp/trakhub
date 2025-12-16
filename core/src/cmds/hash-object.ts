import { Terminal } from "../lib/standard";
import { TBlob, TCommit, TObject, TObjects, TObjectType, TTree } from "../repo/objects";
import { BaseCommand } from "../types";

interface HashObjectArgs {
    path: string;
    type?: string;
    write?: boolean;
}

export class HashObject extends BaseCommand<HashObjectArgs> {
    constructor(args: any[] = []) {
        super(
            'hash-object', 
            'hash an object',
            [
                { name: 'path', type: String, multiple: false, defaultOption: true },
                { name: 'type', type: String },
                { name: 'write', alias: 'w', type: Boolean },
            ],
            args
        )
    }

    async execute(): Promise<void> {
        const type = this._args.type as TObjectType || TObjectType.BLOB;
        const data = await this._repo!.workspace.readFile(this._args.path);
        const baseObject = new TObject(type, data);
        const hash = await this._repo!.objects.writeObject(baseObject, this._args.write);
        Terminal.println(hash);
    }
}