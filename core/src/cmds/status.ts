import { Terminal } from "../lib/standard";
import { BaseCommand } from "./-base";
import { DiffAction } from "../types";

const STATUS_MAP: Record<DiffAction, { long: string; short: string }> = {
    [DiffAction.ADD]: { long: "new file", short: "A" },
    [DiffAction.DELETE]: { long: "deleted", short: "D" },
    [DiffAction.MODIFY]: { long: "modified", short: "M" },
    [DiffAction.UNTRACKED]: { long: "untracked", short: "U" }
};

const CONFLICT_STATUS_MAP: Record<string, { long: string; short: string }> = {
    "1,2,3": { long: "both modified:", short: "UU" },
    "1,2": { long: "deleted by them:", short: "UD" },
    "1,3": { long: "deleted by us:", short: "DU" },
    "2,3": { long: "both added:", short: "AA" },
    "2": { long: "added by us:", short: "AU" },
    "3": { long: "added by them:", short: "UA" }
};

type StatusArgs = {
    short?: boolean
    porcelain?: boolean
    long?: boolean
    verbose?: boolean
}

export class Status extends BaseCommand<StatusArgs> {
    constructor(args: any[] = []) {
        super(
            'status', 
            'creates a commit object that points to',
            [
                { name: 'short', alias: 's', type: Boolean },
                { name: 'porcelain', alias: 'p', type: Boolean },
                { name: 'long', alias: 'l', type: Boolean },
                { name: 'verbose', alias: 'v', type: Boolean },
            ],
            args
        );
    }

    async run(): Promise<void> {
        await this._repo!.index.load();
        await this._repo?.status.initialize();
        this._printResults();
    }

    private _printResults() {
        if (this._args.porcelain) {
            this._printPorcelainFormat();
        } else {
            this._printLongFormat();
        }
    }

    private _printPorcelainFormat() {

    }

    private _printLongFormat() {
        this._printChanges("Changes to be committed", this._repo!.status.indexChanges);
        this._printChanges("Unmerged paths", this._repo!.status.conflicts);
        this._printChanges("Changes not staged for commit", this._repo!.status.workspaceChanges);
        this._printChanges("Untracked files", this._repo!.status.untracked);

        this._printCommitStatus();
    }

    private _printChanges(message: string, changes: any) {
        if (changes.size === 0) return;
        Terminal.println(message);
        for (const entry of changes) {
            if (typeof entry === "string") {
                Terminal.println(`\t${ entry }`);
            } else {
                const [path, action] = entry;
                let status;
                if (typeof action === "string") {
                    status = action ? (STATUS_MAP[action as DiffAction].long ?? ' ') : "";
                } else {
                    status = action ? (CONFLICT_STATUS_MAP[action.sort().join(',')].long ?? ' ') : ""
                }
                Terminal.println(`\t${ status } ${ path }`);
            }
        }
    }

    private _printCommitStatus(): void {
        if (this._repo!.status.indexChanges.size > 0) return;
    
        if (this._repo!.status.workspaceChanges.size > 0) {
            Terminal.println("no changes added to commit");
        } else if (this._repo!.status.untracked.size > 0) {
            Terminal.println("nothing added to commit but untracked files present");
        } else {
            Terminal.println("nothing to commit, working tree clean");
        }
    }
    

    private _statusFor(path: string) {
        if (this._repo!.status.conflicts.has(path)) {
            return CONFLICT_STATUS_MAP[this._repo!.status.conflicts.get(path)!.sort().join(',')].short;
        }

        const indexChange = this._repo!.status.indexChanges.get(path);
        const workspaceChange = this._repo!.status.workspaceChanges.get(path);

        const left = indexChange ? (STATUS_MAP[indexChange].short ?? ' ') : ' ';
        const right = workspaceChange ? (STATUS_MAP[workspaceChange].short ?? ' ') : ' ';
        
        return left + right;
    }

    private _printConflict(conflicts: Record<string, number[]>, prefix: string, useShort = false) {
        for (const [path, stages] of Object.entries(conflicts)) {
            const key = stages.sort((a, b) => a - b).join(',');
            const status = CONFLICT_STATUS_MAP[key];
            const message = status ? (useShort ? status.short : status.long) : "??";
            Terminal.println(`${ prefix }${ message } ${ path }`);
        }
    }
}