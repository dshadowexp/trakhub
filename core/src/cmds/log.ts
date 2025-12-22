import { PrintDiff } from "../lib/print-diff";
import { RevList } from "../lib/rev-list";
import { Terminal } from "../lib/standard";
import type { TCommit } from "../repo/objects";
import type { SymRef } from "../repo/refs";
import { formatGitDate } from "../util";
import { BaseCommand } from "./-base";

type format = 'oneline' | 'medium';

interface LogArgs {
    revs?: string[]
    oneline?: boolean
    abbrev?: boolean
    format?: format;
    patch?: boolean
}

export class Log extends BaseCommand<LogArgs> {
    private _printDiff: PrintDiff;
    private _revList: RevList | null = null;
    private _blank: boolean | undefined;
    private _currentRef: SymRef | null = null;
    private _reverseRefs: Map<string, SymRef> | null = null;

    constructor(args: any[] = []) {
        super(
            'log', 
            'lists the contents of a tree object',
            [
                { name: 'revs', type: String, multiple: true, defaultOption: true },
                { name: 'oneline', alias: 'o', type: Boolean },
                { name: 'abbrev', type: Boolean },
                { name: 'format', alias: 'f', type: String },
                { name: 'patch', alias: 'p', type: Boolean },
            ],
            args
        );

        this._printDiff = new PrintDiff(this._repo!);
    }

    async run(): Promise<void> {
        this._currentRef = await this._repo!.refs.currentRef();
        this._reverseRefs = await this._repo!.refs.reverseRefs();
        this._revList = new RevList(this._repo!, this._args.revs || []);
        await this._revList.initialize();

        for await (const commit of this._revList.each()) {
            this._showCommit(commit);
        }

        process.exit(0);
    }

    private _showCommit(commit: TCommit) {
        switch(this._args.format) {
            case 'oneline':      
                this._showCommitOneline(commit);
                break;
            case 'medium':
                this._showCommitMedium(commit);
                break;
            default: 
                this._showCommitMedium(commit);
        }

        this._showPatch(commit);
    }

    private _showCommitMedium(commit: TCommit) {
        const author = commit.author;
        this._blankLine();

        Terminal.println([
            `commit  ${ commit.hash }\n`,
            `Author: ${ author.serialize() }\n`,
            `Date:   ${ formatGitDate(commit.author.timestamp) }\n`,
            `\n\t${ commit.titleLine }`
        ].join(''))
    }

    private _showCommitOneline(commit: TCommit) {
        Terminal.println(`${ this._repo!.objects.shortHash(commit.hash!) } ${ commit.titleLine }`);
    }

    private _showPatch(commit: TCommit) {
        if (!this._args.patch) return;

        this._blankLine();
        this._printDiff.printCommitDiff(commit.parentHashes[0], commit.hash!);
    }

    // private _decorate(commit: TCommit) {
    //     const refs = this._reverseRefs?.get(commit.hash!);
    //     if (!refs) return;
        
    // }

    // private _abbrev(commit: TCommit) {
    //     if (this._args.abbrev) {
    //         return this._repo!.objects.shortHash(commit.hash!);
    //     } else {
    //         return commit.hash;
    //     }
    // }

    private _blankLine() {
        if (this._args.format === "oneline") return;
        if (this._blank)
            Terminal.println("");

        this._blank = true;
    }
}
