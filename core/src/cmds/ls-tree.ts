import { Terminal } from "../lib/standard";
import { BaseCommand } from "../types";

interface LsTreeArgs {
    hash: string;
    recursive?: boolean;
}

export class LsTree extends BaseCommand<LsTreeArgs> {
    constructor(args: any[] = []) {
        super(
            'ls-tree', 
            'lists the contents of a tree object',
            [
                { name: 'hash', type: String, multiple: false, defaultOption: true },
                { name: 'recursive', alias: 'r', type: Boolean },
            ],
            args
        )
    }

    async execute(): Promise<void> {
        await this._traverse(this._args.hash)
    }

    private async _traverse(treeHash: string, prefix: string = "", recursive: boolean = false) {
        const tree = await this._repo!.objects.readTreeObject(treeHash);
        for (const { mode, name, oid } of tree.entries) {
            const type = mode.startsWith("100") ? "blob" : "tree";
            if (type === "tree" && recursive) {
                await this._traverse(oid, `${ prefix }${ name }/`, true);
            } else {
                Terminal.println(`${ mode } ${ type } ${ oid } ${ name }`);
            }
        }
    }
}