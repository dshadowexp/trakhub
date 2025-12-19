import { BaseCommand } from "./-base";
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

    async run(): Promise<void> {
        const obj = await this._repo!.objects.readObject(this._args.hash);

        if (!obj)
            return;
        const content = obj?.serialize();

        if (this._args.type) {
            Terminal.println(obj.type);
        } else if (this._args.size) {
            Terminal.println(content.byteLength);
        } else if (this._args.pretty) {
            Terminal.println(`${ content.toString() }` || '');
        } else {
            Terminal.println(content.toString());
        }
    }
}