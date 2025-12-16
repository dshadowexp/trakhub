import { BaseCommand } from "../types";
import { Terminal } from "../lib/standard";

interface CatFileArgs {
    hash: string;
    pretty?: boolean;
    type?: boolean;
    size?: boolean;
}

export class CatFile extends BaseCommand<CatFileArgs> {
    constructor(args: any[] = []) {
        super(
            'cat-file', 
            'a plumbing command used to inspect Git objects directly',
            [
                { name: 'hash', type: String, multiple: false, defaultOption: true },
                { name: 'pretty', alias: 'p', type: Boolean },
                { name: 'type', alias: 't', type: Boolean },
                { name: 'size', alias: 's', type: Boolean },
            ],
            args
        )
    }

    async execute(): Promise<void> {
        const object = await this._repo!.objects.readObject(this._args.hash);

        if (!object)
            return;

        if (this._args.type) {
            Terminal.println(object.type);
        } else if (this._args.size) {
            Terminal.println(object.content.byteLength);
        } else if (this._args.pretty) {
            Terminal.println(`${ object?.serialize().toString() }` || '');
        } else {
            Terminal.println(object.content.toString());
        }
    }
}