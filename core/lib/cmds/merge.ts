import { TrakRefs } from "../db/refs"
import { TrakRepository } from "../repository";

export async function merge(sourceBranch: string) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;
    // # 1. VALIDATE STATE
    // # 2. RESOLVE BRANCH REFERENCES
    const currentBranch = await TrakRefs.getCurrentBranch(repo)
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

    // # 5. CHECK FOR FAST-FORWARD MERGE

    // # 6. CHECK IF ALREADY MERGED

    // # 7. PERFORM THREE-WAY MERGE
}