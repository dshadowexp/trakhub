import { TrakCommit, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs"
import { TrakFileSystem } from "../file-system";
import { TrakRepository } from "../repository";
import type { TrakTreeEntry } from "../types";
import { intersection, union } from "../util";
import { extractFilesFromTree, getBranchCommitFiles, hasUncommittedChanges, updateIndexFromTree, updateWorkingDirectory } from "./-shared";

export async function merge(sourceBranch: string, noFF: boolean = false) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    
    // # 1. VALIDATE STATE
    // Check for uncommitted changes
    if (await hasUncommittedChanges(repo))
        throw new Error("Your local changes to the following files would be overwritten by checkout");

    // Check if already in merge state (from previous conflict)
    const mergeHeadFile = await TrakRepository.repoFile(repo, false, "MERGE_HEAD");
    if (mergeHeadFile && TrakFileSystem.exists(mergeHeadFile))
        throw new Error("fatal: You have not concluded your merge (MERGE_HEAD exists).\n" +
              "Please, commit your changes before you merge.");

    // # 2. RESOLVE BRANCH REFERENCES
    const targetCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
    const sourceCommit = await TrakRefs.getBranchCommit(repo, sourceBranch);

    if (!targetCommit)
        throw new Error("You are on a branch yet to be born");
    
    if (!sourceCommit)
        throw new Error(`Branch ${sourceBranch} not found`);

    // # 3. CHECK IF ALREADY UP-TO-DATE
    if (targetCommit === sourceCommit) {
        process.stdout.write("Already up to date.");
        return;
    }

    // # 4. FIND MERGE BASE (common ancestor)
    const mergeBase = await _findMergeBase(repo, targetCommit, sourceCommit);
    if (!mergeBase)
        throw new Error(`fatal: refusing to merge unrelated histories`);

    // # 5. CHECK FOR FAST-FORWARD MERGE
    if (mergeBase === targetCommit) {
        if (noFF) 
            // Force create merge commit even though fast-forward is possible
            await _threeWayMerge(repo, targetCommit, sourceCommit, mergeBase, sourceBranch);
        else
            // Fast-forward merge
            await _fastForwardMerge(repo, sourceCommit, sourceBranch);
        return;
    }

    // # 6. CHECK IF ALREADY MERGED
    if (mergeBase === sourceCommit) {
        // Source is already in target's history
        process.stdout.write("Already up to date.\n");
        return;
    }

    // # 7. PERFORM THREE-WAY MERGE
    await _threeWayMerge(repo, targetCommit, sourceCommit, mergeBase, sourceBranch);
}

/**
 * 
 * @param repo 
 * @param commit1 
 * @param commit2 
 * @returns 
 */
async function _findMergeBase(repo: TrakRepository, commit1: string, commit2: string) {
    // Find the common ancestor of two commits
    // This is the commit where the branches diverged

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
        for (const parent of commitObject.parentHashes) {
            queue.push(parent);
        }
    }

    return [...ancestors]
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
 * @param sourceCommit 
 * @param sourceBranch 
 */
async function _fastForwardMerge(repo: TrakRepository, sourceCommit: string, sourceBranch: string) {
    // Fast-forward: just move HEAD pointer forward
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    process.stdout.write(`Updating ${ currentBranch }..${sourceCommit.substring(0, 7)}`);
    process.stdout.write("Fast-forward");
    
    // 1. Update working directory and index to match source commit
    const sourceTree = await extractFilesFromTree(repo, ((await TrakObjectsBase.readObject(repo, sourceCommit)) as TrakCommit).treeHash);
    
    // # Get current tree
    const currentTree = await getBranchCommitFiles(repo, currentBranch);
    
    // # Update working directory
    await updateWorkingDirectory(repo, currentTree, sourceTree);
    
    // # Update index
    await updateIndexFromTree(repo, sourceTree);
    
    // # 2. Update branch reference
    await TrakRefs.setBranchCommit(repo, currentBranch, sourceCommit);
    
    // # 3. Show stats
    // show_merge_stats(current_tree, source_tree)
}

/**
 * 
 * @param targetCommit 
 * @param sourceCommit 
 * @param mergeBase 
 * @param sourceBranch 
 */
async function _threeWayMerge(repo: TrakRepository, targetCommit: string, sourceCommit: string, mergeBase: string, sourceBranch: string) {
    // Get trees for all three commits
    const baseTree = await extractFilesFromTree(repo, ((await TrakObjectsBase.readObject(repo, mergeBase)) as TrakCommit).treeHash);
    const sourceTree = await extractFilesFromTree(repo, ((await TrakObjectsBase.readObject(repo, sourceCommit)) as TrakCommit).treeHash);
    const targetTree = await extractFilesFromTree(repo, ((await TrakObjectsBase.readObject(repo, targetCommit)) as TrakCommit).treeHash);

    // 2. Perform three-way merge on each file
    const mergedFiles: Record<string, { hasConflict: boolean, content: string }> = {};
    const conflicts = [];

    // Get all files from all three trees
    const allFiles = union(baseTree.map((file) => file.name), union(sourceTree.map((file) => file.name), targetTree.map((file) => file.name)));
    for (const filePath of allFiles) {
        const mergeResult = _mergeFile(
            filePath,
            baseTree.find((element) => filePath === element.name)!,
            sourceTree.find((element) => filePath === element.name)!,
            targetTree.find((element) => filePath === element.name)!,
        );

        if (mergeResult.hasConflict) {
            conflicts.push(filePath);
            mergedFiles[filePath] = mergeResult;
        } else {
            mergedFiles[filePath] = mergeResult;
        }
    }

    // 3. Handle conflicts
    if (conflicts.length > 0) {
        // handle_merge_conflicts(conflicts, merged_files, source_commit, source_branch)
        return;
    }

    // 4. No conflicts - create merge commit
    // create_merge_commit(target_commit, source_commit, merged_files, source_branch)
}

function _mergeFile(filePath: string, baseEntry: TrakTreeEntry, targetEntry: TrakTreeEntry, sourceEntry: TrakTreeEntry): { hasConflict: boolean, content: string } {
    return {
        hasConflict: true,
        content: ''
    }
}

function createMergeCommit(targetCommit: string, sourceCommit: string, mergedFiles: Record<string, { hasConflict: boolean, content: string }>, sourceBranch: string) {
    
}
