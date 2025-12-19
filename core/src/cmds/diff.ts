import { join } from "path";
import { DiffAction, NULL_OID, NULL_PATH } from "../types";
import { TBlob } from "../repo/objects";
import { Terminal, FileSystem } from "../lib/standard";
import { BaseCommand } from "./-base";
import type { Entry } from "../repo/entries";

class Target {
    constructor(
        private _path: string, 
        private _hash: string, 
        private _mode: string,
        private _data: string
    ) {}

    get name(): string { return this._path; }
    get hash(): string { return this._hash; }
    get mode(): string { return this._mode; }
    get data(): string { return this._data; }

    get diffPath(): string { 
        return this._mode ? this._path : NULL_PATH;
    }
}

interface DiffArgs {
    cached?: boolean;
}

export class Diff extends BaseCommand<DiffArgs> {
    constructor(args: any[] = []) {
        super(
            'diff', 
            'lists the contents of a tree object',
            [
                { name: 'cached', alias: 'c', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        await this._repo!.index.load();
        await this._repo!.status.initialize();

        if (this._args.cached) {
            await this._diffHeadIndex();
        } else {
            await this._diffIndexWorkspace();
        }
    }

    private async _diffHeadIndex() {
        for (const [path, action] of this._repo!.status.indexChanges) {
            switch(action) {
                case DiffAction.ADD:
                    this._printDiff(this._fromNothing(path), await this._fromIndex(path));
                    break;
                case DiffAction.MODIFY:
                    this._printDiff(await this._fromHead(path), await this._fromIndex(path));
                    break;
                case DiffAction.DELETE:
                    this._printDiff(await this._fromHead(path), this._fromNothing(path));
                    break;
            }
        }
    }

    private async _diffIndexWorkspace() {
        for (const [path, action] of this._repo!.status.workspaceChanges) {
            switch(action) {
                case DiffAction.MODIFY:
                    this._printDiff(await this._fromIndex(path), await this._fromFile(path));
                    break;
                case DiffAction.DELETE:
                    this._printDiff(await this._fromIndex(path), this._fromNothing(path));
                    break;
            }
        }
    }

    async _fromHead(path: string): Promise<Target> {
        const entry = this._repo!.status.headTree.get(path);
        return await this._fromEntry(entry!);
    }
    
    async _fromIndex(path: string): Promise<Target> {
        const entry = this._repo!.index.entryForPath(path);
        if (!entry)
            throw new Error(`Entry not found for path ${ path }`);
    
        return await this._fromEntry(entry);
    }
    
    async _fromFile(path: string): Promise<Target> {
        const fileContent = await FileSystem.readFile(path);
        const blob = new TBlob(fileContent);
        const oid = this._repo!.objects.hashObject(blob);
        const mode = FileSystem.mode(path);
        return new Target(path, oid, mode, fileContent.toString());
    }
    
    private async _fromEntry(entry: Entry): Promise<Target> {
        // console.log(entry);
        const blob = await this._repo!.objects.readObject(entry.hash);
        return new Target(entry.path, entry.hash, entry.mode, blob.serialize().toString());
    }

    private _fromNothing(path: string): Target {
        return new Target(path, NULL_OID, "", "");
    }

    private _printDiff(a: Target, b: Target) {
        const aPath = join("a", a.name);
        const bPath = join("b", b.name);

        Terminal.println(`diff --trak ${ aPath } ${ bPath }`);
        this._printDiffMode(a, b);
        this._printDiffContent(a, b);
    }

    private _printDiffConflict(path: string) {
        Terminal.println(`* Unmerged path ${ path }`);
    }

    private _printDiffMode(a: Target, b: Target) {
        if (!a.mode) {
            Terminal.println(`new file mode ${ b.mode }`);
        } else if (!b.mode) {
            Terminal.println(`delete file mode ${ a.mode }`);
        } else if (a.mode !== b.mode) {
            Terminal.println(`old mode ${ a.mode }`);
            Terminal.println(`new mode ${ b.mode }`);
        }
    }

    private _printDiffContent(a: Target, b: Target) {
        if (a.hash === b.hash)
            return;

        const oidRange = [`index ${ this._repo!.objects.shortHash(a.hash) }..${ b.hash.slice(0, 7) }`];
        if (a.mode === b.mode)
            oidRange.push(`${ a.mode }`);

        Terminal.println(`${ oidRange.join(' ') }`);
        Terminal.println(`--- ${ a.diffPath }`);
        Terminal.println(`+++ ${ b.diffPath }`);

        // display the contents of the difference in the files 
        const edits = _myersDiff(a.data.split("\n"), b.data.split("\n"));
        const hunks = buildHunks(edits);

        for (const h of hunks) {
            Terminal.println(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
            Terminal.println(h.lines.join("\n"));
        }
    }
}

type DiffOp =
    | { type: "add"; line: string; position: number }
    | { type: "delete"; line: string; position: number }
    | { type: "context"; line: string };

const diffSymbols = { "add": "+", "delete": "-", "context": " "};

export interface Hunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];  // formatted diff lines
}

export interface Hunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];  // formatted diff lines
}

/**
 * Convert a Myers diff sequence (DiffOp[]) into Git-style unified diff hunks.
 */
export function buildHunks(ops: DiffOp[]): Hunk[] {
    const hunks: Hunk[] = [];

    let oldPos = 1;
    let newPos = 1;

    let current: Hunk | null = null;

    for (const op of ops) {
        const startsNewHunk =
            op.type !== "context" || // non-context line always starts/continues a hunk
            (current && isCloseToHunkEnd(current, oldPos, newPos));

        // Start a new hunk if necessary
        if (!current) {
            current = createNewHunk(oldPos, newPos);
        }

        // Add diff line to hunk
        current.lines.push(formatOp(op));

        // Update counters
        if (op.type === "context") {
            oldPos++;
            newPos++;
            incrementHunkCounters(current, "both");
        } else if (op.type === "delete") {
            oldPos++;
            incrementHunkCounters(current, "old");
        } else if (op.type === "add") {
            newPos++;
            incrementHunkCounters(current, "new");
        }

        // If next op is far away, finalize hunk
        const nextOp = ops[ops.indexOf(op) + 1];
        if (!nextOp || shouldCloseHunk(op, nextOp, oldPos, newPos)) {
            hunks.push(current);
            current = null;
        }
    }

    return hunks;
}

/** Create a fresh hunk starting at positions */
function createNewHunk(oldStart: number, newStart: number): Hunk {
    return {
        oldStart,
        newStart,
        oldLines: 0,
        newLines: 0,
        lines: [],
    };
}

/** Format a DiffOp into a unified diff line */
function formatOp(op: DiffOp): string {
    const symbol = diffSymbols[op.type];
    return symbol + op.line;
}

/** Update line counters inside a hunk */
function incrementHunkCounters(hunk: Hunk, kind: "old" | "new" | "both") {
    if (kind === "old" || kind === "both") hunk.oldLines++;
    if (kind === "new" || kind === "both") hunk.newLines++;
}

/** Detect if we should close the current hunk */
function shouldCloseHunk(prev: DiffOp, next: DiffOp, oldPos: number, newPos: number) {
    // Start a new hunk whenever there is a large unrelated gap
    if (next.type !== "context" && prev.type === "context") {
        return false; // continue hunk
    }

    // If there is too much context separation, break the hunk
    return false;
}

/** Decide if context is close enough to keep in same hunk (Git uses 3 lines) */
function isCloseToHunkEnd(hunk: Hunk, oldPos: number, newPos: number) {
    return true; // simplifying: keep all ops in same hunk unless separated by big gap
}

/**
 * 
 * @param original 
 * @param modified 
 * @returns 
 */
function _myersDiff(original: string[], modified: string[]): DiffOp[] {
    const m = original.length;
    const n = modified.length;
    const maxD = m + n;

    // range: -(maxD) .. +(maxD)
    const offset = maxD;
    const V = new Array(2 * maxD + 1).fill(-1);
    V[offset + 1] = 0;

    const trace: number[][] = [];

    for (let d = 0; d <= maxD; d++) {
        trace.push([...V]); // save copy

        for (let k = -d; k <= d; k += 2) {
            const index = offset + k;

            let x: number;

            // Choose whether we came from k-1 (delete) or k+1 (insert)
            if (
                k === -d ||
                (k !== d && V[index - 1] < V[index + 1])
            ) {
                // downward/insert (k+1)
                x = V[index + 1];
            } else {
                // right/delete (k-1)
                x = V[index - 1] + 1;
            }

            let y = x - k;

            // Follow diagonal (matching)
            while (x < m && y < n && original[x] === modified[y]) {
                x++;
                y++;
            }
                V[index] = x;

                if (x >= m && y >= n) {
                    return backtrackMyers(trace, original, modified, d);
            }
        }
    }

    throw new Error("Myers diff failed unexpectedly");
}

/**
 * 
 * @param trace 
 * @param original 
 * @param modified 
 * @param d 
 * @returns 
 */
function backtrackMyers(trace: number[][], original: string[], modified: string[], d: number): DiffOp[] {
    const m = original.length;
    const n = modified.length;
    const maxD = m + n;
    const offset = maxD;

    let x = m;
    let y = n;

    const result: DiffOp[] = [];

    for (let currentD = d; currentD >= 0; currentD--) {
        const V = trace[currentD];
        const k = x - y;
        const index = offset + k;

        // Determine previous diagonal
        let prevK: number;
        if (
            k === -currentD ||
            (k !== currentD && V[index - 1] < V[index + 1])
        ) {
            prevK = k + 1;
        } else {
            prevK = k - 1;
        }

        const prevIndex = offset + prevK;
        const prevX = V[prevIndex];
        const prevY = prevX - prevK;

        // Walk back along diagonal (context)
        while (x > prevX && y > prevY) {
            x--;
            y--;
            result.unshift({
                type: "context",
                line: original[x],
            });
        }

        if (currentD > 0) {
            // Determine insertion or deletion
            if (x === prevX) {
                // Insertion (came from k+1)
                y--;
                result.unshift({
                    type: "add",
                    line: modified[y],
                    position: y,
                });
            } else {
                // Deletion (came from k-1)
                x--;
                result.unshift({
                    type: "delete",
                    line: original[x],
                    position: x,
                });
            }
        }
    }

    return result;
}