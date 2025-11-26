type DiffOp =
  | { type: "add"; line: string; position: number }
  | { type: "delete"; line: string; position: number }
  | { type: "context"; line: string };

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

const original = ["a", "b", "c", "a", "b", "b", "a"];
const modified = ["c", "b", "a", "b", "a", "c"];

console.log(_myersDiff(original, modified));
