import { TrakBlob, TrakCommit, TrakObjectsBase } from "../db/objects";
import { TrakRefs } from "../db/refs"
import { TrakIndex } from "../db/t-index";
import { migrate } from "../lib/migration";
import { resolveStartPoint } from "../lib/revision";
import { FileSystem, Terminal } from "../lib/standard";
import { DiffAction, treeDiff, type DiffEntry } from "../lib/tree-diff";
import { TrakRepository } from "../repository";
import { type EntryInfo } from "../types";
import { intersection, shortHash, union } from "../util";
import { hasUncommittedChanges } from "./-shared";
import { writeCommit } from "./commit";
import { PendingCommit } from "../db/pending-commit";

interface ConflictInfo {
    path: string
    base?: EntryInfo;
    left?: EntryInfo;
    right?: EntryInfo;
};

type MergeArgs = {
    noFF?: boolean
    continue?: boolean
    abort?: boolean
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

    // Load the index for updates
    await TrakIndex.load(repo);

    // handle_continue if @options[:mode] == :continue
    if (options.continue) {
        await resumeMerge(repo, headCommit);
        return;
    }

    // handle_in_progress_merge if pending_commit.in_progress?
    if (await PendingCommit.inProgress(repo)) {
        _mergeInProgress();
        return;
    }

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
        return; // process.exit(0)
    }

    // # 1. VALIDATE STATE
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

export async function resumeMerge(repo: TrakRepository, headCommit: string) {
    // handle_conflicted_index
    if (TrakIndex.hasConflicts()) {
        const message = "Committing is not possible because you have unmerged files";
        Terminal.printerr(`error: ${message}.`);
        // Terminal.printerr(CONFLICT_MESSAGE);
        process.exit(128);
    }

    // Resume merge
    const parentHashes = [headCommit, await PendingCommit.oid(repo)];
    const message = await PendingCommit.message(repo);
    const commitHash = await writeCommit(repo, parentHashes, message);
    await PendingCommit.clear(repo);
}

function _mergeInProgress() {
    const message = "Merging is not possible because you have unmerged files";
    Terminal.printerr(`error: ${ message }.\n`);
    //Terminal.error(CONFLICT_MESSAGE);
    process.exit(128);
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
    // show_merge_stats(current_tree, source_tree) //
}

export async function _threeWayMerge(repo: TrakRepository,
    baseCommit: string,
    headCommit: string,
    mergeCommit: string
) {
    Terminal.println("Performing three-way merge...");

    // Pending commit here
    await PendingCommit.start(repo, mergeCommit, ''); //stdin.read

    // RESOLVE MERGE
    // Get changes from base to each branch
    const headChanges = await treeDiff(repo, baseCommit, headCommit);
    const mergeChanges = await treeDiff(repo, baseCommit, mergeCommit);

    // Build path maps for O(1) lookup
    const headMap = buildPathMap(headChanges);
    const mergeMap = buildPathMap(mergeChanges);

    // Get all unique paths that changed
    const allPaths = union(Object.keys(headMap), Object.keys(mergeMap));

    // Track conflicts and merged entries
    const cleanDiff = new Map<string, DiffEntry>();
    const conflicts: ConflictInfo[] = [];
    const untracked = new Map<string, EntryInfo>();

    for (const path of Object.keys(mergeMap)) {
        const headDiff = headMap[path]; //left diff
        const mergeDiff = mergeMap[path]; // right diff
        const baseEntry: EntryInfo = { oid: headDiff.oldOid, mode: headDiff.oldOid } // base

        if (!headDiff) {
            cleanDiff.set(path, {
                ...mergeDiff,
                action: DiffAction.ADD,
            });
        } 
        
        if (headDiff.newOid === mergeDiff.newOid) continue;

        const [isModeClean, resultMode] = mergeModes(baseEntry.mode, headDiff.newMode, mergeDiff.newMode);
        const [isContentClean, resultOid] = await mergeBlobs(repo, baseEntry.oid, headDiff.newOid, mergeDiff.newOid);

        cleanDiff.set(path, {
            path,
            action: DiffAction.MODIFY,
            oldMode: headDiff.newMode,
            oldOid: headDiff.newOid,
            newMode: resultMode,
            newOid: resultOid
        });


        if (isModeClean && isContentClean) return;

        conflicts.push({
            path,
            base: baseEntry,
            left: { oid: headDiff.newOid, mode: headDiff.newMode },
            right: { oid: mergeDiff.newOid, mode: mergeDiff.newMode }
        })
    }

    
    // apply migration with cleanDiff
    await migrate(repo, Object.values(cleanDiff));

    // Write all updates to index
    await TrakIndex.save(repo);

    // COMMIT MERGE
    const parentHashes = [headCommit, mergeCommit];
    const message = await PendingCommit.message(repo);
    const commitHash = await writeCommit(repo, parentHashes, message);

    await PendingCommit.clear(repo);

    // Add conflicts to index
    conflicts.forEach((conflict) => {
        const { path, base, left, right } = conflict;
        TrakIndex.addConflictSet(path, [base, left, right]);
    });

    // Write untracked files
    for (const [path, entry] of untracked) {
        const blob = await TrakObjectsBase.readObject(repo, entry.oid!);
        await FileSystem.writeFile(path, blob!.content);
    }

    if (TrakIndex.hasConflicts()) {
        Terminal.println("Automatic merge failed; fix conflicts and then commit the result.");
        return; //exit 1
    }
}

function logConflict(conflict: ConflictInfo, rename: string | null = null) {
    const { path, base, left, right } = conflict;

    if (left && right) {
        // log_left_right_conflict(path)
    } else if (base && (left || right)) {
        // log_modify_delete_conflict(path, rename)
    } else {
        // log_file_directory_conflict(path, rename)
    }
}

/**
 * 
def log_left_right_conflict(path)
type = @conflicts[path][0] ? "content" : "add/add"
log "CONFLICT (#{ type }): Merge conflict in #{ path }"
end

def log_modify_delete_conflict(path, rename)
deleted, modified = log_branch_names(path)
rename = rename ? " at #{ rename }" : ""
log "CONFLICT (modify/delete): #{ path } " +
"deleted in #{ deleted } and modified in #{ modified }. " +
"Version #{ modified } of #{ path } left in tree#{ rename }."
end

def log_branch_names(path)
a, b = @inputs.left_name, @inputs.right_name
@conflicts[path][1] ? [b, a] : [a, b]
end

def log_file_directory_conflict(path, rename)
type = @conflicts[path][1] ? "file/directory" : "directory/file"
branch, _
= log_branch_names(path)
log "CONFLICT (#{ type }): There is a directory " +
"with name #{ path } in #{ branch }. " +
"Adding #{ path } as #{ rename }"
end
 */

function mergeModes(baseMode: string | undefined, headMode: string | undefined, mergeMode: string | undefined): [ boolean, string | undefined ] {
    return merge3(baseMode, headMode, mergeMode) || [false, headMode];
}

async function mergeBlobs(repo: TrakRepository, baseOid: string | undefined, headOid: string | undefined, mergeOid: string | undefined): Promise<[ boolean, string | undefined ]> {
    const result = merge3(baseOid, headOid, mergeOid);
    if (result !== undefined)
        return result;

    const mergedBlob = new TrakBlob(Buffer.from(await mergeData(repo, headOid!, mergeOid!)));
    await TrakObjectsBase.writeObject(mergedBlob, repo);
    return [false, mergedBlob.hash()];
}

/**
 * Simple three-way merge for OIDs and modes
 * Returns [clean, resultOid] or undefined if detailed merge needed
 * 
 * @param base 
 * @param left 
 * @param right 
 * @returns 
 */
function merge3(base: string | undefined, left: string | undefined, right: string | undefined): [ boolean, string | undefined ] | undefined {
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

async function mergeData(repo: TrakRepository, headOid: string, mergeOid: string) {
    const headBlob = await TrakObjectsBase.readObject(repo, headOid);
    const mergeBlob = await TrakObjectsBase.readObject(repo, mergeOid);

    return [
        "<<<<<<< #{ @inputs.left_name }\n",
        headBlob?.content.toString(),
        "=======\n",
        mergeBlob?.content.toString(),
        ">>>>>>> #{ @inputs.right_name }\n"
    ].join("");
}

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













