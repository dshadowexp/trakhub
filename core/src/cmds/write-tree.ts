import { BaseCommand } from "./-base";
import { writeTree } from "./-shared";
import { Terminal } from "../lib/standard";

interface WriteTreeArgs {}

export class WriteTree extends BaseCommand<WriteTreeArgs> {
    constructor(args: any[] = []) {
        super(
            'write-tree', 
            'serializes the index into immutable tree objects',
            [],
            args
        )
    }

    async run(): Promise<void> {
        await this._repo!.index.load();
        const tree = await writeTree(this._repo!);
        Terminal.println(tree.hash);
    }
}