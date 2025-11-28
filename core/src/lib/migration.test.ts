import { sortByDepth } from "./migration";
import { DiffAction, type DiffEntry } from "./tree-diff";

console.log("Running tests for sortByDepth...");

// Test data with varying path depths
const testEntries: DiffEntry[] = [
    { action: DiffAction.DELETE, path: 'dir/subdir/file.txt' }, // depth 2
    { action: DiffAction.DELETE, path: 'file.txt' },           // depth 0
    { action: DiffAction.DELETE, path: 'dir/file.txt' },      // depth 1
];

// --- Test Case 1: Ascending sort (default) ---
const sortedAsc = sortByDepth([...testEntries]);
const expectedAscPaths = ['file.txt', 'dir/file.txt', 'dir/subdir/file.txt'];
const actualAscPaths = sortedAsc.map(e => e.path);

console.assert(
  JSON.stringify(actualAscPaths) === JSON.stringify(expectedAscPaths),
  'Test Case 1 Failed: Ascending sort.\\nExpected: %o\\nActual:   %o',
  expectedAscPaths,
  actualAscPaths
);