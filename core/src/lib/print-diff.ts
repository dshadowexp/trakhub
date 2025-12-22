import { join } from "path";
import { NULL_OID, NULL_PATH } from "../types";
import { Terminal } from "./standard";
import type { BaseEntry } from "../repo/entries";
import type { TRepository } from "../repo/repository";
import type { TObjects } from "../repo/objects";

export class Target {
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

export class PrintDiff {
    constructor(private _repo: TRepository) {}

    async fromEntry(path: string, entry: BaseEntry | undefined): Promise<Target> {
        if (!entry) return this.fromNothing(path);
        const blob = await this._repo!.objects.readObject(entry.hash);
        return new Target(path, entry.hash, entry.mode, blob.serialize().toString());
    }

    fromNothing(path: string): Target {
        return new Target(path, NULL_OID, "", "");
    }
    
    printDiff(a: Target, b: Target) {
        const aPath = join("a", a.name);
        const bPath = join("b", b.name);

        Terminal.println(`diff --trak ${ aPath } ${ bPath }`);
        this._printDiffMode(a, b);
        this._printDiffContent(a, b);
    }

    async printCommitDiff(aCommitOid: string, bCommitOid: string, differ?: TObjects) {
        if (!differ)
            differ = this._repo!.objects;

        const diffs = await differ.treeDiff(aCommitOid, bCommitOid);
        const paths = diffs.sort((a, b) => a.path.localeCompare(b.path)).map(d => d.path);

        for (const path of paths) {
            const diff = diffs.find(d => d.path === path);
            if (!diff) continue;
            const { new: newEntry, old: oldEntry } = diff;
            this.printDiff(await this.fromEntry(path, oldEntry), await this.fromEntry(path, newEntry));
        }
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