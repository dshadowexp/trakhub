import { BaseCommand } from "./-base";
import { Terminal } from "../lib/standard";
import { TObjectType } from "../repo/objects";

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

    async run(): Promise<void> {
        const type = this._args.type as TObjectType || TObjectType.BLOB;
        const data = await this._repo!.workspace.readFile(this._args.path);
        const hash = this._repo!.objects.hashContent(data);

        // if (this._args.write)
        //     await this._repo!.objects.writeObject(hash)
                
        Terminal.println(hash);
    }
}