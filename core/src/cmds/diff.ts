import { DiffAction } from "../types";
import { TBlob } from "../repo/objects";
import { FileSystem } from "../lib/standard";
import { BaseCommand } from "./-base";
import { PrintDiff, Target } from "../lib/print-diff";
import { Revision } from "../lib/revision";

interface DiffArgs {
    revs?: string[]
    cached?: boolean;
    patch?: boolean
}

export class Diff extends BaseCommand<DiffArgs> {
    private _printDiff: PrintDiff;

    constructor(args: any[] = []) {
        super(
            'diff', 
            'lists the contents of a tree object',
            [
                { name: 'revs', type: String, multiple: true },
                { name: 'cached', alias: 'c', type: Boolean },
                { name: 'patch', alias: 'p', type: Boolean },
            ],
            args
        );
        this._printDiff = new PrintDiff(this._repo!);
    }

    async run(): Promise<void> {
        await this._repo!.index.load();
        await this._repo!.status.initialize();

        if (this._args.cached) {
            await this._diffHeadIndex();
        } else if (this._args.revs?.length === 2) {
            await this._diffCommits();
        } else {
            await this._diffIndexWorkspace();
        }
    }

    private async _diffHeadIndex() {
        for (const [path, action] of this._repo!.status.indexChanges) {
            switch(action) {
                case DiffAction.ADD:
                    this._printDiff.printDiff(this._printDiff.fromNothing(path), await this._fromIndex(path));
                    break;
                case DiffAction.MODIFY:
                    this._printDiff.printDiff(await this._fromHead(path), await this._fromIndex(path));
                    break;
                case DiffAction.DELETE:
                    this._printDiff.printDiff(await this._fromHead(path), this._printDiff.fromNothing(path));
                    break;
            }
        }
    }

    private async _diffCommits() {
        if (!this._args.patch) return;
        const a = await new Revision(this._repo!, this._args.revs![0]).resolve();
        const b = await new Revision(this._repo!, this._args.revs![1]).resolve();
        this._printDiff.printCommitDiff(a, b);
    }

    private async _diffIndexWorkspace() {
        for (const [path, action] of this._repo!.status.workspaceChanges) {
            switch(action) {
                case DiffAction.MODIFY:
                    this._printDiff.printDiff(await this._fromIndex(path), await this._fromFile(path));
                    break;
                case DiffAction.DELETE:
                    this._printDiff.printDiff(await this._fromIndex(path), this._printDiff.fromNothing(path));
                    break;
            }
        }
    }

    async _fromHead(path: string): Promise<Target> {
        const entry = this._repo!.status.headTree.get(path);
        return await this._printDiff.fromEntry(path, entry);
    }
    
    async _fromIndex(path: string): Promise<Target> {
        const entry = this._repo!.index.entryForPath(path);
        if (!entry)
            throw new Error(`Entry not found for path ${ path }`);
    
        return await this._printDiff.fromEntry(path, entry);
    }
    
    async _fromFile(path: string): Promise<Target> {
        const fileContent = await FileSystem.readFile(path);
        const blob = new TBlob(fileContent);
        const oid = this._repo!.objects.hashObject(blob);
        const mode = FileSystem.mode(path);
        return new Target(path, oid, mode, fileContent.toString());
    }
}

