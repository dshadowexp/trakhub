import { join } from "path";
import { TrakRepository } from "../repository";
import type { TrakIndexRecord, TrakTreeEntry } from "../types";
import { TrakBlob, TrakObjectsBase } from "../db/objects";
import { Terminal, FileSystem } from "../lib/standard";
import { TrakIndex } from "../db/t-index";
import { TrakRefs } from "../db/refs";
import { getTreeFilesFromCommit, getStatus } from "./-shared";
import { shortHash } from "../util";

const NULL_PATH = "/dev/null";
type DiffOp =
    | { type: "add"; line: string; position: number }
    | { type: "delete"; line: string; position: number }
    | { type: "context"; line: string };
const diffSymbols = { "add": "+", "delete": "-", "context": " "};
type Target = TrakTreeEntry & { data: string };

type DiffArgs = {
    cached?: boolean;
}

export async function diff(options: DiffArgs = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Load index (Staging area)
    const indexEntries = await TrakIndex.loadIndex(repo);

    if (options.cached) {
        await _diffHeadIndex(repo, indexEntries);
    } else {
        await _diffIndexWorkspace(repo, indexEntries);
    }
}

/**
 * 
 * @param repo 
 * @param indexEntries 
 */
async function _diffHeadIndex(repo: TrakRepository, indexEntries: TrakIndexRecord) {
    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);

    // Get committed files
    const committedFiles: Record<string, TrakTreeEntry> = (await getTreeFilesFromCommit(repo, currentBranch)).reduce((current, value) => {
        return { ...current, [value.name]: value }
    }, {});

    const [stagedNew, stagedModified, stagedDeleted] = await getStatus(Object.keys(indexEntries), Object.keys(committedFiles), async (path) => indexEntries[path], async (path) => committedFiles[path].oid);

    if (stagedNew.length > 0) {
        for (const path of stagedNew) {
            _printDiff(_fromNothing(path), await _fromIndex(repo, path));
        }
    }
    
    if (stagedModified.length > 0) {
        for (const path of stagedModified) {
            _printDiff(await _fromHead(repo, path), await _fromIndex(repo, path));
        }
    }

    if (stagedDeleted.length > 0) {
        for (const path of stagedDeleted) {
            _printDiff(await _fromHead(repo, path), _fromNothing(path));
        }
    }
}

/**
 * 
 * @param repo 
 * @param workingFiles 
 * @param indexEntries 
 */
async function _diffIndexWorkspace(repo: TrakRepository, indexEntries: TrakIndexRecord) {
    // Scan working directory
    const workingFiles = await FileSystem.listFiles(repo.workTree);

    // COMPARE INDEX vs WORKING DIRECTORY (unstaged changes)
    const [untracked, unstagedModified, unstagedDeleted] = await getStatus(workingFiles, Object.keys(indexEntries), async (path) => indexEntries[path], async (path) => {
        const fileData = await FileSystem.readFile(path);
        const blob = new TrakBlob(fileData);
        return blob.hash();
    });

    if (unstagedModified.length > 0) {
        for (const path of unstagedModified) {
            _printDiff(await _fromIndex(repo, path), await _fromFile(path));
        }
    }

    if (unstagedDeleted.length > 0) {
        for (const path of unstagedDeleted) {
            _printDiff(await _fromIndex(repo, path), _fromNothing(path));
        }
    }
}

/**
 * 
 * @param repo 
 * @param path 
 * @returns 
 */
async function _fromHead(repo: TrakRepository, path: string): Promise<Target> {
    const currentBranch = await TrakRefs.getCurrentBranch(repo); // Fetch head instead
    const committedFiles: Record<string, TrakTreeEntry> = (await getTreeFilesFromCommit(repo, currentBranch)).reduce((current, value) => {
        return { ...current, [value.name]: value }
    }, {});
    return await _fromEntry(repo, { name: path, oid: committedFiles[path].oid, mode: "" });
}

/**
 * 
 * @param repo 
 * @param path 
 * @returns 
 */
async function _fromIndex(repo: TrakRepository, path: string): Promise<Target> {
    const indexEntries = await TrakIndex.loadIndex(repo);
    const entry = indexEntries[path];
    if (!entry)
        throw new Error(`Entry not found for path ${ path }`);

    return await _fromEntry(repo, { name: path, oid: entry, mode: "" });
}

/**
 * 
 * @param path 
 * @returns 
 */
async function _fromFile(path: string): Promise<Target> {
    const fileContent = await FileSystem.readFile(path);
    const blob = new TrakBlob(fileContent);
    const oid = blob.hash();
    const mode = FileSystem.stats(path).mode.toString(8);
    return {
        name: path,
        oid,
        mode,
        data: fileContent.toString(),
    };
}

/**
 * 
 * @param path 
 * @returns 
 */
function _fromNothing(path: string): Target {
    return {
        name: path,
        oid: "0".repeat(40), // Null oid
        mode: "",
        data: NULL_PATH, // Null path
    };
}

/**
 * 
 * @param repo 
 * @param entry 
 * @returns 
 */
async function _fromEntry(repo: TrakRepository, entry: TrakTreeEntry): Promise<Target> {
    const blob = await TrakObjectsBase.readObject(repo, entry.oid);
    if (!blob) 
        throw new Error(`Cannot read object fromEntry ${ entry.oid }`);

    return {
        name: entry.name,
        oid: entry.oid,
        mode: entry.mode,
        data: blob?.content.toString() || "",
    }
}

/**
 * 
 * @param a 
 * @param b 
 */
function _printDiff(a: Target, b: Target) {
    const aPath = join("a", a.name);
    const bPath = join("b", b.name);

    Terminal.println(`diff --trak ${ aPath } ${ bPath }\n`);
    _printDiffMode(a, b);
    _printDiffContent(a, b);
}

/**
 * 
 * @param a 
 * @param b 
 */
function _printDiffMode(a: Target, b: Target) {
    if (!a.mode) {
        Terminal.println(`new file mode ${ b.mode }`);
    } else if (!b.mode) {
        Terminal.println(`delete file mode ${ a.mode }`);
    } else if (a.mode !== b.mode) {
        Terminal.println(`old mode ${ a.mode }`);
        Terminal.println(`new mode ${ b.mode }`);
    }
}

/**
 * 
 * @param a 
 * @param b 
 * @returns 
 */
function _printDiffContent(a: Target, b: Target) {
    if (a.oid === b.oid)
        return;

    const oidRange = [`index ${ shortHash(a.oid) }..${ b.oid.slice(0, 7) }`];
    if (a.mode === b.mode)
        oidRange.push(`${ a.mode }`);

    Terminal.println(`${ oidRange.join(' ') }`);
    Terminal.println(`--- ${ a.mode ? a.name : NULL_PATH }`);
    Terminal.println(`+++ ${ b.mode ? b.name : NULL_PATH }`);

    // display the contents of the difference in the files 
    const edits = _myersDiff([], []);
    for (const op of edits) {
        Terminal.println(`${ diffSymbols[op.type] }${ op.line }`);
    }
}

// TODO: Implement hunks

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

// const original = ["a", "b", "c", "a", "b", "b", "a"];
// const modified = ["c", "b", "a", "b", "a", "c"];

// console.log(_myersDiff(original, modified));