import { join } from "path";
import { TrakBlob, TrakCommit, TrakObjectsBase, TrakTree } from "../db/objects";
import { TrakRefs } from "../db/refs"
import { TrakIndex } from "../db/t-index";
import { migrate } from "../lib/migration";
import { resolveStartPoint } from "../lib/revision";
import { FileSystem, Terminal } from "../lib/standard";
import { DiffAction, treeDiff, type DiffEntry } from "../lib/tree-diff";
import { TrakRepository } from "../repository";
import { UnixFileModeEnum } from "../types";
import { intersection, shortHash, union } from "../util";
import { extractFilesFromTree, hasUncommittedChanges } from "./-shared";
import { writeCommit } from "./commit";
import { mkdir } from "fs/promises";
import { commitTree } from "./commit-tree";

type MergePathResult = {
    conflict: boolean;
    conflictType?: "content" | "delete/modify" | "both-added" | "unknown";
    deleted?: boolean;
    oid?: string;
    mode?: string;
    conflictOid?: string;
};
  
type ConflictInfo = {
    path: string;
    type: string;
    ours: DiffEntry;
    theirs: DiffEntry;
};

type MergeArgs = {
    noFF?: boolean
}

export async function merge(sourceBranch: string, options: MergeArgs = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Check if already in merge state (from previous conflict)
    const mergeHeadFile = await TrakRepository.repoFile(repo, false, "MERGE_HEAD");
    if (mergeHeadFile && FileSystem.exists(mergeHeadFile))
        throw new Error("fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.");

    // # 2. RESOLVE BRANCH REFERENCES
    const headCommit = await TrakRefs.getCurrentHeadCommit(repo);
    const mergeCommit = await resolveStartPoint(repo, sourceBranch);

    if (!headCommit)
        throw new Error("You are on a branch yet to be born");
    
    if (!mergeCommit)
        throw new Error(`Branch ${sourceBranch} not found`);

    // # 3. CHECK IF ALREADY UP-TO-DATE
    if (headCommit === mergeCommit) {
        Terminal.println("Already up to date.");
        return;
    }

    // # 4. FIND MERGE BASE (common ancestor)
    const baseCommit = await _findMergeBase(repo, headCommit, mergeCommit);
    if (!baseCommit)
        throw new Error(`fatal: refusing to merge unrelated histories`);

    // # 5. CHECK IF ALREADY MERGED - Null Merge
    if (baseCommit === mergeCommit) {
        // Source is already in target's history
        Terminal.println("Already up to date.\n");
        return;
    }

    // # 1. VALIDATE STATE
    // Load the index for updates
    await TrakIndex.load(repo);

    // Check if changes are uncommitted
    if (await hasUncommittedChanges(repo))
        throw new Error(`Your local changes to the following files would be overwritten by checkout`);

    // # 6. CHECK FOR FAST-FORWARD MERGE
    let merge;
    if (baseCommit === headCommit) {
        if (options.noFF) {
            // Force create merge commit even though fast-forward is possible
            merge = await _threeWayMerge(repo, baseCommit, headCommit, mergeCommit);
        } else {
            // Fast-forward merge
            await _fastForwardMerge(repo, headCommit, mergeCommit);
            return;
        }
            
    }

    // # 7. PERFORM THREE-WAY MERGE
    merge = await _threeWayMerge(repo, baseCommit, headCommit, mergeCommit);
}

/**
 * Find the common ancestor of two commits
 * This is the commit where the branches diverged
 * 
 * @param repo 
 * @param commit1 
 * @param commit2 
 * @returns 
 */
async function _findMergeBase(repo: TrakRepository, commit1: string, commit2: string) {
    // Build ancestor sets for both commits
    const ancestors1 = await _getAllAncestors(repo, commit1);
    const ancestors2 = await _getAllAncestors(repo, commit2);
 
    // Find common ancestor
    const commonAncestors = intersection(ancestors1, ancestors2);

    // No common history
    if (commonAncestors.length === 0)
        return null;

    // Find the "best" common ancestor (most recent)
    // For simplicity, we'll use the one closest to both commits
    let bestAncestor = null, minDistance = Number.POSITIVE_INFINITY;

    for (const ancestor of commonAncestors) {
        const dist1 = await _commonDistance(repo, ancestor, commit1);
        const dist2 = await _commonDistance(repo, ancestor, commit2);
        const totalDistance = dist1 + dist2;

        if (totalDistance < minDistance) {
            minDistance = totalDistance;
            bestAncestor = ancestor;
        }
    }

    return bestAncestor;
}

/**
 * 
 * @param repo 
 * @param commit 
 * @returns 
 */
async function _getAllAncestors(repo: TrakRepository, commit: string): Promise<string[]> {
    // # Get all ancestor commits (breadth-first search)
    const ancestors = new Set<string>();
    const queue = [commit];

    while (queue.length > 0) {
        const current = queue.shift()!;

        if (ancestors.has(current))
            continue;

        ancestors.add(current);
        const commitObject = (await TrakObjectsBase.readObject(repo, current)) as TrakCommit;

        // Add parent(s) to queue
        queue.push(...commitObject.parentHashes);
    }

    return [...ancestors];
}

/**
 * 
 * @param repo 
 * @param fromCommit 
 * @param toCommit 
 * @returns 
 */
async function _commonDistance(repo: TrakRepository, fromCommit: string, toCommit: string): Promise<number> {
    // Calculate number of commits between two commits
    let distance = 0;
    let current = toCommit;
    let visited = new Set<string>();

    while (current !== fromCommit) {
        if (visited.has(current))
            return Number.POSITIVE_INFINITY;

        visited.add(current);
        const commitObject = (await TrakObjectsBase.readObject(repo, current)) as TrakCommit;

        if (commitObject.parentHashes.length === 0)
            return Number.POSITIVE_INFINITY;

        current = commitObject.parentHashes[0];
        distance++;
    }

    return distance;
}

/**
 * 
 * @param mergeCommit - 
 * @param headCommit - Current commit of the HEAD 
 */
async function _fastForwardMerge(repo: TrakRepository, headCommit: string, mergeCommit: string) {
    // Fast-forward: just move HEAD pointer forward
    Terminal.println(`Updating ${ shortHash(headCommit) }..${ shortHash(mergeCommit) }`);
    Terminal.println("Fast-forward");

    // Resolve tree diff
    const changes = await treeDiff(repo, headCommit, mergeCommit);

    // Apply changes with migration
    await migrate(repo, changes);

    // Write all updates to index
    await TrakIndex.save(repo);

    // Set HEAD to point to the target branch
    await TrakRefs.setCurrentHeadCommit(repo, mergeCommit);
    
    // # 3. Show stats
    // show_merge_stats(current_tree, source_tree)
}

/**
 * Perform three-way merge between base, head, and merge commits
 */
export async function _threeWayMerge(
    repo: TrakRepository,
    baseCommit: string,
    headCommit: string,
    mergeCommit: string
): Promise<{ success: boolean; conflicts: ConflictInfo[] }> {
    Terminal.println("Performing three-way merge...");
  
    // Get changes from base to each branch
    const headChanges = await treeDiff(repo, baseCommit, headCommit);
    const mergeChanges = await treeDiff(repo, baseCommit, mergeCommit);
  
    // Build path maps for O(1) lookup
    const headMap = buildPathMap(headChanges);
    const mergeMap = buildPathMap(mergeChanges);
  
    // Get all unique paths that changed
    const allPaths = union(Object.keys(headMap), Object.keys(mergeMap));
  
    // Load base tree entries
    const baseTreeEntries = await extractFilesFromTree(repo, baseCommit);
  
    // Track conflicts and merged entries
    const conflicts: ConflictInfo[] = [];
    const mergedEntries = new Map<string, { oid: string; mode: string }>();
  
    // Start with all base entries
    for (const [path, entry] of Object.entries(baseTreeEntries)) {
        mergedEntries.set(path, { oid: entry.oid, mode: entry.mode });
    }
  
    // Process each changed path
    for (const path of allPaths) {
        const headDiff = headMap[path];
        const mergeDiff = mergeMap[path];
        const baseEntry = baseTreeEntries.find(entry => entry.name === path)!;
  
        const result = await mergePath(
            repo,
            path,
            baseEntry,
            headDiff || null,
            mergeDiff || null
        );
  
        if (result.conflict) {
            // Record conflict
            conflicts.push({
                path,
                type: result.conflictType || "unknown",
                ours: headDiff!,
                theirs: mergeDiff!,
            });
    
            // Add conflict entries to index (stages 1, 2, 3)
            const conflictSet: { mode: string; hash: string }[] = [];
    
            if (baseEntry) {
                conflictSet.push({ mode: baseEntry.mode, hash: baseEntry.oid });
            }
    
            if (headDiff && headDiff.newOid && headDiff.newMode) {
                conflictSet.push({ mode: headDiff.newMode, hash: headDiff.newOid });
            }
    
            if (mergeDiff && mergeDiff.newOid && mergeDiff.newMode) {
                conflictSet.push({
                    mode: mergeDiff.newMode,
                    hash: mergeDiff.newOid,
                });
            }
    
            if (conflictSet.length > 0) {
                TrakIndex.addConflictSet(path, conflictSet);
            }
    
            // Write conflicted file to working directory
            if (result.conflictOid) {
                mergedEntries.set(path, {
                    oid: result.conflictOid,
                    mode: result.mode || UnixFileModeEnum.REGULAR_FILE,
                });
            }
        } else {
            if (result.deleted) {
                mergedEntries.delete(path);
                TrakIndex.remove(path);
            } else if (result.oid && result.mode) {
                mergedEntries.set(path, {
                    oid: result.oid,
                    mode: result.mode,
                });
                TrakIndex.add(path, result.oid);
            }
        }
    }
  
    // Apply merged entries to working directory
    await applyMergedEntries(repo, mergedEntries);
  
    if (conflicts.length > 0) {
        // Save MERGE_HEAD for conflict resolution
        const mergeHeadPath = await TrakRepository.repoFile(
            repo,
            true,
            "MERGE_HEAD"
        );
        if (mergeHeadPath) {
            await FileSystem.writeFile(mergeHeadPath, Buffer.from(mergeCommit));
        }
    
        // Save index with conflict markers
        await TrakIndex.save(repo);
    
        Terminal.println(
            `Automatic merge failed; fix conflicts and then commit the result.`
        );
        Terminal.println(`\nConflicts in:`);
        conflicts.forEach((c) => Terminal.println(`  ${c.path}`));
    
        return { success: false, conflicts };
    } else {
        // Clean merge - build merged tree
        // const mergedTreeHash = await buildTreeFromEntries(repo, mergedEntries);
    
        // Save index
        await TrakIndex.save(repo);
    
        // Create merge commit with two parents
        const mergeMessage = `Merge commit '${mergeCommit.substring(0, 7)}'`;
        const newCommit = await commitTree({
            treeHash: '', //mergedTreeHash,
            parents: [headCommit, mergeCommit],
            message: mergeMessage
        },  repo);
    
        // Update HEAD
        await TrakRefs.setCurrentHeadCommit(repo, newCommit!);
    
        Terminal.println(`Merge made by the 'recursive' strategy.`);
        return { success: true, conflicts: [] };
    }
}
  
  /**
   * Merge a single path that changed in both branches
   */
async function mergePath(
    repo: TrakRepository,
    path: string,
    baseEntry: { oid: string; mode: string } | undefined,
    headDiff: DiffEntry | null,
    mergeDiff: DiffEntry | null
): Promise<MergePathResult> {
    // Case 1: Only HEAD changed
    if (headDiff && !mergeDiff) {
        return applyChange(headDiff);
    }
  
    // Case 2: Only merge branch changed
    if (!headDiff && mergeDiff) {
        return applyChange(mergeDiff);
    }
  
    // Case 3: Both branches changed
    if (headDiff && mergeDiff) {
        return await mergeBothChanged(repo, path, baseEntry, headDiff, mergeDiff);
    }
  
    // Case 4: No changes (shouldn't happen)
    if (baseEntry) {
        return { conflict: false, oid: baseEntry.oid, mode: baseEntry.mode };
    }
  
    return { conflict: false, deleted: true };
  }
  
  /**
   * Apply a single change from one branch
   */
function applyChange(diff: DiffEntry): MergePathResult {
    if (diff.action === DiffAction.DELETE) {
        return { conflict: false, deleted: true };
    } else {
        return {
            conflict: false,
            oid: diff.newOid,
            mode: diff.newMode,
        };
    }
}
  
  /**
   * Merge when both branches changed the same path
   */
async function mergeBothChanged(
    repo: TrakRepository,
    path: string,
    baseEntry: { oid: string; mode: string } | undefined,
    headDiff: DiffEntry,
    mergeDiff: DiffEntry
): Promise<MergePathResult> {
    // Subcase 1: Both made identical changes
    if (
        headDiff.action === mergeDiff.action &&
        headDiff.newOid === mergeDiff.newOid &&
        headDiff.newMode === mergeDiff.newMode
    ) {
        return applyChange(headDiff);
    }
  
    // Subcase 2: Both deleted
    if (
        headDiff.action === DiffAction.DELETE &&
        mergeDiff.action === DiffAction.DELETE
    ) {
        return { conflict: false, deleted: true };
    }
  
    // Subcase 3: Delete/Modify conflict
    if (
        (headDiff.action === DiffAction.DELETE &&
            mergeDiff.action === DiffAction.MODIFY) ||
        (headDiff.action === DiffAction.MODIFY &&
            mergeDiff.action === DiffAction.DELETE)
    ) {
        const keepDiff =
            mergeDiff.action === DiffAction.MODIFY ? mergeDiff : headDiff;
        return {
            conflict: true,
            conflictType: "delete/modify",
            oid: keepDiff.newOid,
            mode: keepDiff.newMode,
        };
    }
  
    // Subcase 4: Both modified - try content merge
    if (
        headDiff.action === DiffAction.MODIFY &&
        mergeDiff.action === DiffAction.MODIFY
    ) {
        return await mergeContent(repo, path, baseEntry, headDiff, mergeDiff);
    }
  
    // Subcase 5: Both added differently
    if (
        headDiff.action === DiffAction.ADD &&
        mergeDiff.action === DiffAction.ADD
    ) {
        return await mergeContent(repo, path, undefined, headDiff, mergeDiff);
    }
  
    // Unknown conflict
    return {
        conflict: true,
        conflictType: "unknown",
        oid: headDiff.newOid,
        mode: headDiff.newMode,
    };
}
  
  /**
   * Merge file contents using three-way merge
   */
async function mergeContent(
    repo: TrakRepository,
    path: string,
    baseEntry: { oid: string; mode: string } | undefined,
    headDiff: DiffEntry,
    mergeDiff: DiffEntry
): Promise<MergePathResult> {
    const baseOid = baseEntry?.oid || null;
    const headOid = headDiff.newOid!;
    const mergeOid = mergeDiff.newOid!;
  
    // Try simple merge3 first
    const simpleResult = merge3(baseOid, headOid, mergeOid);
    if (simpleResult !== undefined) {
        const [clean, resultOid] = simpleResult;
        if (!resultOid) {
            return { conflict: false, deleted: true };
        }
        return {
            conflict: !clean,
            oid: resultOid,
            mode: headDiff.newMode || mergeDiff.newMode,
        };
    }
  
    // Need line-by-line merge - create conflict markers
    const headBlob = (await TrakObjectsBase.readObject(
      repo,
      headOid
    )) as TrakBlob;
    const mergeBlob = (await TrakObjectsBase.readObject(
      repo,
      mergeOid
    )) as TrakBlob;
  
    const conflictContent = buildConflictMarkers(
      headBlob.content.toString(),
      mergeBlob.content.toString()
    );
  
    const conflictBlob = new TrakBlob(Buffer.from(conflictContent));
    await TrakObjectsBase.writeObject(conflictBlob, repo);
  
    return {
        conflict: true,
        conflictType: "content",
        conflictOid: conflictBlob.hash(),
        oid: conflictBlob.hash(),
        mode: headDiff.newMode || mergeDiff.newMode,
    };
}

/**
 * Simple three-way merge for OIDs
 * Returns [clean, resultOid] or undefined if detailed merge needed
 * 
 * @param base 
 * @param left 
 * @param right 
 * @returns 
 */
function merge3(base: string | null, left: string | undefined, right: string | undefined): [ boolean, string | undefined ] | undefined {
    // If left is missing → take right (unmerged)
    if (!left) return [false, right];

    // If right is missing → take left (unmerged)
    if (!right) return [false, left];

    // If left equals base OR left equals right → take right (merged)
    if (left === base || left === right) {
        return [true, right];
    } else if (right === base) {
        // If right equals base → take left (merged)
        return [true, left];
    }
}


  
/**
 * Build conflict markers for file content
 */
function buildConflictMarkers(headContent: string, mergeContent: string): string {
    return [
      "<<<<<<< HEAD",
      headContent,
      "=======",
      mergeContent,
      ">>>>>>> MERGE_HEAD",
    ].join("\n");
}
  
  /**
   * Build path map from diff entries
   */
// function buildPathMap(changes: DiffEntry[]): Map<string, DiffEntry> {
//     const map = new Map<string, DiffEntry>();
//     for (const change of changes) {
//         map.set(change.path, change);
//     }
//     return map;
// }

/**
 * Build path map from diff entries
 * 
 * @param changes 
 * @returns 
 */
function buildPathMap(changes: DiffEntry[]): Record<string, DiffEntry> {
    return changes.reduce((map, change) => {
        return { ...map, [change.path]: change};
    }, {});
}
  
  /**
   * Apply merged entries to working directory
   */
async function applyMergedEntries(
    repo: TrakRepository,
    mergedEntries: Map<string, { oid: string; mode: string }>
): Promise<void> {
    for (const [path, entry] of mergedEntries) {
      const blob = (await TrakObjectsBase.readObject(repo, entry.oid)) as TrakBlob;
      const fullPath = join(repo.workTree, path);
  
      // Ensure parent directory exists
      const parentDir = join(fullPath, "..");
      if (!FileSystem.exists(parentDir)) {
            await mkdir(parentDir, { recursive: true });
      }
  
      await FileSystem.writeFile(fullPath, blob.content);
    }
}
  

// /**
//  * 
//  * @param targetCommit 
//  * @param sourceCommit 
//  * @param mergeBase 
//  * @param sourceBranch 
//  */
// async function _threeWayMerge(repo: TrakRepository, baseCommit: string, headCommit: string, mergeCommit: string) {
//     const mergeChanges = await treeDiff(repo, baseCommit, mergeCommit);
//     const headChanges = await treeDiff(repo, baseCommit, headCommit);
//     const cleanDiff: DiffEntry[] = [];
//     const conflicts: Record<string, any> = {};

//     // Build maps for O(1) lookup: path -> DiffEntry
//     const mergeChangesMap = constructChangesFilePathMap(mergeChanges);
//     const headChangesMap = constructChangesFilePathMap(headChanges);
//     const baseTreeEntries = await extractFilesFromTree(repo, baseCommit);

//     // Get all unique paths that changed
//     const allChangedPaths = union(Object.keys(mergeChangesMap), Object.keys(headChangesMap));

//     // Process each changed path
//     for (const path of allChangedPaths) {
//         const headChange = headChangesMap[path];
//         const mergeChange = mergeChangesMap[path];
//         const baseEntry = baseTreeEntries.find(entry => entry.name === path)!;

//         if (!headChange) {
//             cleanDiff.push({ path, newMode: baseEntry.mode, newOid: baseEntry.oid });
//             continue;
//         }

//         if (headChange === mergeChange) {
//             continue;
//         }

//         const [isModeClean, resultMode] = mergeModes(baseEntry?.mode, headChange.newMode, mergeChange.newMode);
//         const [isContentClean, resultOid] = await mergeBlobs(repo, baseEntry.oid, headChange.newOid, mergeChange.newOid);

//         headChange.newMode = resultMode;
//         headChange.newOid = resultOid;
//         cleanDiff.push(headChange);

//         if (!(isModeClean && isContentClean)) {
//             conflicts[path] = [baseEntry, headChange, mergeChange];
//         } else {
//             cleanDiff.push({ path, newMode: resultMode, newOid: resultOid })
//         }
//     }

//     // Resolve merge
//     // Apply changes with migration
//     await migrate(repo, cleanDiff);
//     // Add conflicts to index
//     // write untracked files
//     if (TrakIndex.hasConflicts())
//         throw new Error("fatal: Merge conflict")

//     // Write index to file
//     await TrakIndex.save(repo);
//     if (conflicts.length > 0)
//         return;

//     // Commit Merge
//     const parents = [headCommit, mergeCommit];
//     const message = "Read from stdin";
//     await writeCommit(repo, parents, message);

// }

// /**
//  * 
//  * @param baseMode 
//  * @param headMode 
//  * @param mergeMode 
//  * @returns 
//  */
// function mergeModes(baseMode: string, headMode: string | undefined, mergeMode: string | undefined): [ boolean, string | undefined ] {
//     return merge3(baseMode, headMode, mergeMode) || [false, headMode];
// }

// /**
//  * 
//  * @param repo 
//  * @param baseOid 
//  * @param headOid 
//  * @param mergeOid 
//  * @returns 
//  */
// async function mergeBlobs(repo: TrakRepository, baseOid: string, headOid: string | undefined, mergeOid: string | undefined): Promise<[ boolean, string | undefined ]> {
//     const result = merge3(baseOid, headOid, mergeOid);
//     if (result !== undefined)
//         return result;

//     const mergedBlob = new TrakBlob(Buffer.from(await mergeData(repo, headOid!, mergeOid!)));
//     await TrakObjectsBase.writeObject(mergedBlob, repo);
//     return [false, mergedBlob.hash()];
// }

// /**
//  * 
//  * @param repo 
//  * @param headOid 
//  * @param mergeOid 
//  * @returns 
//  */
// async function mergeData(repo: TrakRepository, headOid: string, mergeOid: string) {
//     const headBlob = await TrakObjectsBase.readObject(repo, headOid);
//     const mergeBlob = await TrakObjectsBase.readObject(repo, mergeOid);

//     return [
//         "<<<<<<< #{ @inputs.left_name }\n",
//         headBlob?.content.toString(),
//         "=======\n",
//         mergeBlob?.content.toString(),
//         ">>>>>>> #{ @inputs.right_name }\n"
//     ].join("");
// }







